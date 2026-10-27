import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const require = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare } = require('miniflare');
const { build } = require('esbuild');
const origin = 'https://crosslab.test';
const source = file => JSON.stringify(resolve(file).replaceAll('\\', '/'));
const fakeCode = 'review-integration-only-access-code';

test('public review routes enforce trusted sessions, durable admissions and ticket ownership', async t => {
  const bundle = await build({
    stdin: { contents: `
      import worker from ${source('worker/index.ts')};
      import { ResearchQuota } from ${source('worker/research-quota.ts')};
      import { initialState, exampleProblem } from ${source('lib/research.ts')};
      export class TestQuota extends ResearchQuota {
        current = Date.now();
        now() { return this.current; }
        async fetch(request) { this.current = Number(request.headers.get('x-test-now')) || Date.now(); return super.fetch(request); }
      }
      export default { fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === '/_test/context') return Response.json({ ...initialState().context, problem: exampleProblem });
        const broken = request.headers.get('x-test-budget');
        const quota = env.CROSSLAB_RESEARCH_QUOTA;
        return worker.fetch(request, { ...env,
          CROSSLAB_LOGIN_GUARD: { idFromName(name) { return name; }, get() { return { fetch() { return Response.json({ success: true, retryAfter: 0 }); } }; } },
          CROSSLAB_RESEARCH_QUOTA: broken === 'missing' ? undefined : {
            idFromName(name) { return quota.idFromName(name); },
            get(id) { const stub = quota.get(id); return { fetch(input, init) {
              if (broken === 'throw') throw new Error('Test unavailable');
              if (broken === 'invalid') return Response.json({ kind: 'dispatch' });
              const forwarded = new Request(input, init);
              if (request.headers.has('x-test-now')) forwarded.headers.set('x-test-now', request.headers.get('x-test-now'));
              return stub.fetch(forwarded);
            } }; }
          },
          ASSETS: { fetch(asset) { const path = new URL(asset.url).pathname;
            return path.startsWith('/_next/static/') || ['/favicon.svg', '/examples/sciencepal-pilot.json', '/private-note.json'].includes(path)
              ? new Response('LOCAL STATIC FILE') : new Response(null, { status: 404 }); } }
        }, ctx);
      }};
    `, resolveDir: process.cwd(), sourcefile: 'review-integration.ts', loader: 'ts' },
    bundle: true, platform: 'neutral', format: 'esm', target: 'es2022',
    external: ['cloudflare:workers', 'node:*'], write: false, define: { 'import.meta.env.DEV': 'false' },
    plugins: [{ name: 'route-test-handler', setup(builder) {
      builder.onResolve({ filter: /^vinext\/server\/fetch-handler$/ }, () => ({ path: 'routes', namespace: 'review-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'review-test' }, () => ({ loader: 'ts', resolveDir: process.cwd(), contents: `
        import * as sciencepal from ${source('app/api/review/sciencepal/route.ts')};
        import * as workflow from ${source('app/api/review/workflow/route.ts')};
        import * as owner from ${source('app/api/sciencepal/route.ts')};
        export default { fetch(request) {
          const path = new URL(request.url).pathname;
          const route = path === '/api/review/sciencepal' ? sciencepal : path === '/api/review/workflow' ? workflow : path === '/api/sciencepal' ? owner : null;
          if (route) return route[request.method](request);
          return new Response(path === '/review' ? 'PUBLIC REVIEW PAGE' : 'PRIVATE OWNER PAGE');
        }};` }));
    } }],
  });
  let creates = 0;
  let failNext = false;
  const runs = new Map();
  const runtime = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    bindings: { CROSSLAB_AUTH_REQUIRED: 'true', CROSSLAB_REVIEW_ENABLED: 'true', CROSSLAB_ACCESS_CODE: fakeCode, SCIENCEPAL_API_KEY: 'fake-review-sciencepal-key', SCIENCEPAL_AGENT_ID: 'fake-agent' },
    durableObjects: { CROSSLAB_RESEARCH_QUOTA: { className: 'TestQuota', useSQLite: true } },
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://sciencepal.ai', 'no live service is contacted');
      if (url.pathname === '/api/agent/initiate') {
        creates++;
        if (failNext) { failNext = false; return new Response('simulated uncertain upstream failure', { status: 504 }); }
        const prompt = new URLSearchParams(await request.text()).get('prompt');
        const requestId = /"requestId":"([a-f0-9-]+)"/.exec(prompt)?.[1];
        const fp = /"contextFingerprint":"([a-f0-9]+)"/.exec(prompt)?.[1];
        const id = 'run-' + creates;
        runs.set(id, { requestId, fp, status: 'running', threadId: 'thread-' + creates });
        return Response.json({ thread_id: 'thread-' + creates, agent_run_id: id });
      }
      if (url.pathname.startsWith('/api/agent-run/')) {
        const id = url.pathname.split('/').at(-1), run = runs.get(id);
        assert.ok(run);
        return Response.json({ id, thread_id: run.threadId, status: run.status });
      }
      if (/\/thread\/[^/]+\/sandbox$/.test(url.pathname)) {
        const thread = url.pathname.split('/').at(-2);
        return Response.json({ thread_id: thread, sandbox_id: thread, project_id: 'project-test' });
      }
      if (/\/sandboxes\/[^/]+\/files\/content$/.test(url.pathname)) {
        const run = [...runs.values()].find(run => url.searchParams.get('path')?.includes(run.requestId));
        assert.ok(run);
        return Response.json({ schemaVersion: 1, requestId: run.requestId, action: 'analyze', contextFingerprint: run.fp, status: 'asked', question: '仅文献设计还是包含实际计算？' });
      }
      throw new Error('Unexpected mock upstream path: ' + url.pathname);
    },
  });
  const now = Date.now();
  const fetch = (path, options = {}) => runtime.dispatchFetch(origin + path, { redirect: 'manual', ...options });
  const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
  const visitor = async () => cookie(await fetch('/review'));
  const post = (body, session, options = {}) => {
    const { headers = {}, path = '/api/review/sciencepal', ...rest } = options;
    return fetch(path, { method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: session || '', 'x-test-now': String(now), ...headers }, ...rest });
  };
  const status = async (session, extra = {}) => (await (await fetch('/api/review/workflow', { headers: { Cookie: session, 'x-test-now': String(now), ...extra } })).json()).quota;
  let context, first, second, native, ownerCookie;
  try {
    context = await (await fetch('/_test/context')).json();
    await t.test('review signs a separate cookie and exposes only its public allowlist', async () => {
      const page = await fetch('/review');
      assert.equal(page.status, 200);
      assert.equal(await page.text(), 'PUBLIC REVIEW PAGE');
      first = cookie(page);
      assert.ok(first.startsWith('__Host-crosslab_review='));
      assert.match(page.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);
      assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
      const repeat = await fetch('/review', { headers: { Cookie: first } });
      assert.equal(repeat.headers.get('Set-Cookie'), null);
      for (const path of ['/_next/static/chunks/test.js', '/examples/sciencepal-pilot.json', '/favicon.svg']) assert.equal((await fetch(path)).status, 200);
      for (const path of ['/', '/api/sciencepal', '/private-note.json', '/api/review/workflow']) assert.equal((await fetch(path)).status, 401);
      assert.equal((await fetch('/api/sciencepal', { headers: { Cookie: first, 'x-role': 'owner' } })).status, 401);
      assert.equal((await status(first)).totalUsed, 0);
    });
    await t.test('missing origins, forged or duplicate cookies cannot authorize research', async () => {
      const input = { op: 'start', action: 'analyze', context, requestId: randomUUID() };
      for (const Origin of ['', 'null', 'https://elsewhere.test']) assert.equal((await post(input, first, { headers: { Origin } })).status, 403);
      const forged = first.slice(0, -2) + 'XX';
      assert.equal((await post(input, forged)).status, 401);
      assert.equal((await post(input, first + '; ' + first)).status, 401);
      assert.equal(creates, 0);
    });
    await t.test('invalid input and unconfirmed deep work consume no budget', async () => {
      assert.equal((await post({ op: 'start' }, first)).status, 400);
      assert.equal((await post({ op: 'start', action: 'deep', context, requestId: randomUUID() }, first)).status, 400);
      assert.equal((await status(first)).totalUsed, 0);
      assert.equal(creates, 0);
    });
    await t.test('simultaneous identical launches dispatch once and replay their durable receipt', async () => {
      const input = { op: 'start', action: 'analyze', context, requestId: randomUUID() };
      const responses = await Promise.all(Array.from({ length: 6 }, () => post(input, first)));
      assert.equal(creates, 1);
      assert.ok(responses.every(response => [202, 409].includes(response.status)));
      native = await (await post(input, first)).json();
      assert.equal(native.status, 'running');
      assert.equal((await status(first)).totalUsed, 1);
      assert.equal((await post({ ...input, context: { ...context, note: 'changed' } }, first)).status, 409);
      assert.equal(creates, 1);
    });
    await t.test('poll does not spend quota and tickets cannot cross review sessions or owner API', async () => {
      for (let i = 0; i < 3; i++) assert.equal((await post({ op: 'poll', context, ticket: native.ticket }, first)).status, 202);
      assert.equal((await status(first)).totalUsed, 1);
      second = await visitor();
      assert.equal((await post({ op: 'poll', context, ticket: native.ticket }, second)).status, 409);
      const login = await fetch('/__crosslab/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: fakeCode }).toString() });
      ownerCookie = cookie(login);
      assert.equal(login.status, 303);
      assert.equal((await post({ op: 'poll', context, ticket: native.ticket }, ownerCookie, { path: '/api/sciencepal' })).status, 409);
      assert.equal(creates, 1);
    });
    await t.test('asked replies require their signed audience and count a fresh task', async () => {
      runs.get(native.runId).status = 'asked';
      const asked = await (await post({ op: 'poll', context, ticket: native.ticket }, first)).json();
      assert.equal(asked.status, 'asked');
      const reply = { op: 'reply', context, ticket: asked.ticket, messageId: randomUUID(), message: '仅文献与方法设计，不执行计算。', question: asked.question };
      assert.equal((await post(reply, second, { headers: { 'x-test-now': String(now + 60001) } })).status, 409);
      assert.equal((await post(reply, first)).status, 429);
      assert.equal((await post(reply, first, { headers: { 'x-test-now': String(now + 60001) } })).status, 202);
      assert.equal(creates, 2);
      assert.equal((await status(first)).totalUsed, 2);
    });
    await t.test('uncertain upstream submissions retain their slot and never automatically restart', async () => {
      failNext = true;
      const input = { op: 'start', action: 'analyze', context, requestId: randomUUID() };
      assert.equal((await post(input, second)).status, 504);
      const before = creates;
      assert.equal((await post(input, second)).status, 504);
      assert.equal(creates, before);
      assert.equal((await status(second)).totalUsed, 3);
    });
    await t.test('unavailable or malformed budget bindings fail closed before any upstream write', async () => {
      const session = await visitor();
      const before = creates;
      for (const scenario of ['missing', 'throw', 'invalid']) {
        const response = await post({ op: 'start', action: 'analyze', context, requestId: randomUUID() }, session, { headers: { 'x-test-budget': scenario } });
        assert.equal(response.status, 503, scenario);
      }
      assert.equal(creates, before);
    });
    await t.test('owner API shares the global hard cap while demo and case viewing remain available', async () => {
      for (let i = 0; i < 27; i++) assert.equal((await post({ op: 'start', action: 'analyze', context, requestId: randomUUID() }, ownerCookie, { path: '/api/sciencepal' })).status, 202);
      const current = await status(first);
      assert.equal(current.totalUsed, 30);
      assert.equal(current.totalRemaining, 0);
      for (const [session, path] of [[ownerCookie, '/api/sciencepal'], [await visitor(), '/api/review/sciencepal']]) {
        const denied = await post({ op: 'start', action: 'analyze', context, requestId: randomUUID() }, session, { path });
        assert.equal(denied.status, 429);
        assert.equal((await denied.json()).code, 'quota_total_exhausted');
      }
      const before = creates;
      assert.equal((await post({ action: 'analyze', context }, first, { path: '/api/review/workflow' })).status, 200);
      assert.equal((await fetch('/examples/sciencepal-pilot.json')).status, 200);
      assert.equal((await fetch('/review')).status, 200);
      assert.equal(creates, before);
    });
  } finally { await runtime.dispose(); }
});

