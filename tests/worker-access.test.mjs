import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

// Run the actual gate in workerd, using fake secrets and a local limiter double.
// The wrapper exists only in this test bundle; it performs no external requests.
const wranglerRequire = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');
const origin = 'https://crosslab.test';
const secret = 'local-test-access-code-5e8cd2f37b';
const cookieName = '__Host-crosslab_access';

test('private Worker protects pages, research APIs and assets in the production runtime', async t => {
  const source = resolve('worker/access.ts').replaceAll('\\', '/');
  const bundled = await build({
    stdin: {
      contents: `
        import { withWebsiteAccess, signAccessSession, verifyAccessSession } from ${JSON.stringify(source)};
        const secret = ${JSON.stringify(secret)};
        let nextCalls = 0;
        const limiterCalls = [];
        export default { async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/_test/sign') {
            const now = Number(url.searchParams.get('now') || Date.now());
            return Response.json({ token: await signAccessSession(secret, url.origin, now) });
          }
          if (url.pathname === '/_test/crypto') {
            const now = Date.now();
            const token = await signAccessSession(secret, url.origin, now);
            const altered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
            return Response.json({
              valid: await verifyAccessSession(token, secret, url.origin, now),
              tampered: await verifyAccessSession(altered, secret, url.origin, now),
              wrongSecret: await verifyAccessSession(token, secret + '-rotated', url.origin, now),
              wrongOrigin: await verifyAccessSession(token, secret, 'https://elsewhere.test', now),
              expired: await verifyAccessSession(token, secret, url.origin, now + 28800001),
              secretAbsent: !token.includes(secret),
              unique: token !== await signAccessSession(secret, url.origin, now),
            });
          }
          if (url.pathname === '/_test/stats') return Response.json({ nextCalls, limiterCalls });
          const scenario = request.headers.get('x-test-scenario') || 'normal';
          const env = {
            CROSSLAB_AUTH_REQUIRED: scenario === 'disabled' ? 'false' : 'true',
            CROSSLAB_ACCESS_CODE: scenario === 'missing-secret' ? undefined
              : scenario === 'short-secret' ? 'too-short'
              : scenario === 'blank-secret' ? ' '.repeat(20)
              : scenario === 'long-secret' ? 'x'.repeat(257)
              : scenario === 'rotated-secret' ? secret + '-rotated' : secret,
            CROSSLAB_LOGIN_GUARD: scenario === 'missing-limiter' ? undefined : {
              idFromName(name) { limiterCalls.push(name); return name; },
              get() { return { async fetch() {
                if (scenario === 'broken-limiter') throw new Error('test limiter unavailable');
                if (scenario === 'failed-limiter') return new Response('unavailable', { status: 500 });
                if (scenario === 'malformed-limiter') return Response.json({ success: 'yes', retryAfter: 0 });
                if (scenario === 'invalid-retry') return Response.json({ success: false, retryAfter: 1000 });
                return Response.json({ success: scenario !== 'limited', retryAfter: scenario === 'limited' ? 60 : 0 });
              }}; }
            },
          };
          return withWebsiteAccess(request, env, async () => {
            nextCalls++;
            return new Response('PRIVATE APPLICATION CONTENT', {
              headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' }
            });
          });
        }};
      `,
      resolveDir: process.cwd(), sourcefile: 'worker-access-check.ts', loader: 'ts',
    },
    bundle: true, platform: 'neutral', format: 'esm', target: 'es2022',
    external: ['node:buffer'], write: false,
  });
  let outboundCalls = 0;
  const runtime = new Miniflare({
    modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    outboundService() {
      outboundCalls++;
      throw new Error('Access tests must not contact external services');
    },
  });
  const request = (path, options = {}) => runtime.dispatchFetch(origin + path, { redirect: 'manual', ...options });
  const login = (options = {}) => {
    const { code = secret, headers = {}, ...rest } = options;
    return request('/__crosslab/login', {
      method: 'POST', body: new URLSearchParams({ code }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin,
        'CF-Connecting-IP': '192.0.2.7', ...headers }, ...rest,
    });
  };
  let sessionCookie;
  try {
    await t.test('disabled gate preserves local development behavior', async () => {
      const response = await request('/api/sciencepal', { headers: { 'x-test-scenario': 'disabled' } });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'PRIVATE APPLICATION CONTENT');
    });

    await t.test('missing and weak access codes fail closed on every entry point', async () => {
      const before = (await (await request('/_test/stats')).json()).nextCalls;
      for (const scenario of ['missing-secret', 'short-secret', 'blank-secret', 'long-secret']) {
        for (const path of ['/', '/api/sciencepal', '/assets/client.js', '/__crosslab/login', '/__crosslab/logout']) {
          const response = await request(path, { headers: { 'x-test-scenario': scenario } });
          assert.equal(response.status, 503, `${scenario}: ${path}`);
          assert.doesNotMatch(await response.text(), /PRIVATE APPLICATION CONTENT/);
        }
      }
      assert.equal((await (await request('/_test/stats')).json()).nextCalls, before);
    });

    await t.test('anonymous pages, APIs and static assets never reach the application', async () => {
      const before = (await (await request('/_test/stats')).json()).nextCalls;
      for (const [path, accept] of [['/', 'text/html'], ['/api/sciencepal', 'text/html'], ['/api/workflow', 'application/json'], ['/assets/client.js', '*/*']]) {
        const response = await request(path, { headers: { Accept: accept } });
        assert.equal(response.status, 401, path);
        assert.match(response.headers.get('Cache-Control') || '', /no-store/);
        assert.doesNotMatch(await response.text(), /PRIVATE APPLICATION CONTENT/);
        if (path.startsWith('/api/')) assert.match(response.headers.get('Content-Type') || '', /application\/json/);
      }
      assert.equal((await (await request('/_test/stats')).json()).nextCalls, before);
    });

    await t.test('HTTPS is required before accepting credentials', async () => {
      const upgrade = await runtime.dispatchFetch('http://crosslab.test/?view=research', { redirect: 'manual' });
      assert.equal(upgrade.status, 308);
      assert.equal(upgrade.headers.get('Location'), origin + '/?view=research');
      const insecure = await runtime.dispatchFetch('http://crosslab.test/__crosslab/login', {
        method: 'POST', headers: { Origin: 'http://crosslab.test', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: secret }).toString(), redirect: 'manual',
      });
      assert.equal(insecure.status, 400);
      assert.equal(insecure.headers.get('Set-Cookie'), null);
    });

    await t.test('login form is self-contained and does not expose the access code', async () => {
      const response = await request('/__crosslab/login', { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Referrer-Policy'), 'same-origin', 'native browser forms must retain their same-origin Origin header');
      const html = await response.text();
      assert.match(html, /type=["']password["']/);
      assert.match(html, /name=["']code["']/);
      assert.equal(html.includes(secret), false);
      assert.match(response.headers.get('Cache-Control') || '', /no-store/);
    });

    await t.test('login requires exact same-origin requests', async () => {
      for (const value of ['', 'null', 'https://attacker.test', origin + '.attacker.test']) {
        const response = await login({ headers: { Origin: value } });
        assert.equal(response.status, 403, `Origin ${JSON.stringify(value)}`);
        assert.equal(response.headers.get('Set-Cookie'), null);
      }
    });

    await t.test('login rejects oversized bodies and incorrect codes', async () => {
      const oversized = await login({ code: 'x'.repeat(2049) });
      assert.equal(oversized.status, 413);
      assert.equal(oversized.headers.get('Set-Cookie'), null);
      const wrong = await login({ code: 'definitely-incorrect-code' });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.headers.get('Referrer-Policy'), 'same-origin', 'retry forms must remain submittable');
      assert.equal(wrong.headers.get('Set-Cookie'), null);
    });

    await t.test('limiter failures and throttling prevent even a correct login', async () => {
      for (const [scenario, expected] of [['missing-limiter', 503], ['broken-limiter', 503], ['failed-limiter', 503], ['malformed-limiter', 503], ['invalid-retry', 503], ['limited', 429]]) {
        const response = await login({ headers: { 'x-test-scenario': scenario } });
        assert.equal(response.status, expected, scenario);
        assert.equal(response.headers.get('Set-Cookie'), null);
      }
      const { limiterCalls } = await (await request('/_test/stats')).json();
      assert.ok(limiterCalls.length >= 3, 'valid and failed credential attempts reach the limiter');
      assert.ok(limiterCalls.every(key => typeof key === 'string' && key.length > 0));
      assert.ok(limiterCalls.every(key => !key.includes(secret)), 'rate-limit keys do not contain credentials');
      assert.ok(limiterCalls.every(key => !key.includes('192.0.2.7')), 'rate-limit object names do not contain the visitor IP');
    });

    await t.test('successful login issues a bounded, secure host-only session', async () => {
      const response = await login();
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('Location'), '/');
      const setCookie = response.headers.get('Set-Cookie');
      assert.ok(setCookie?.startsWith(cookieName + '='));
      assert.match(setCookie, /;\s*HttpOnly(?:;|$)/i);
      assert.match(setCookie, /;\s*Secure(?:;|$)/i);
      assert.match(setCookie, /;\s*SameSite=Strict(?:;|$)/i);
      assert.match(setCookie, /;\s*Path=\/(?:;|$)/i);
      assert.match(setCookie, /;\s*Max-Age=28800(?:;|$)/i);
      assert.doesNotMatch(setCookie, /;\s*Domain=/i);
      assert.equal(setCookie.includes(secret), false);
      sessionCookie = setCookie.split(';')[0];
    });

    await t.test('authenticated application responses cannot enter a public cache', async () => {
      assert.ok(sessionCookie);
      for (const path of ['/', '/api/sciencepal', '/api/workflow', '/assets/client.js']) {
        const response = await request(path, { headers: { Cookie: sessionCookie } });
        assert.equal(response.status, 200, path);
        assert.equal(await response.text(), 'PRIVATE APPLICATION CONTENT');
        assert.match(response.headers.get('Cache-Control') || '', /private/);
        assert.match(response.headers.get('Cache-Control') || '', /no-store/);
        assert.doesNotMatch(response.headers.get('Cache-Control') || '', /public/);
      }
    });

    await t.test('HMAC sessions reject tampering, secret rotation, other hosts and expiry', async () => {
      const cryptoChecks = await (await request('/_test/crypto')).json();
      assert.deepEqual(cryptoChecks, { valid: true, tampered: false, wrongSecret: false,
        wrongOrigin: false, expired: false, secretAbsent: true, unique: true });
      const token = sessionCookie.slice(cookieName.length + 1);
      const changed = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
      const expired = await (await request('/_test/sign?now=' + (Date.now() - 28800001))).json();
      for (const value of [cookieName + '=' + changed, cookieName + '=' + expired.token, cookieName + '=garbage']) {
        const response = await request('/api/sciencepal', { headers: { Cookie: value } });
        assert.equal(response.status, 401);
      }
      const rotated = await request('/api/sciencepal', { headers: { Cookie: sessionCookie, 'x-test-scenario': 'rotated-secret' } });
      assert.equal(rotated.status, 401);
      const otherHost = await runtime.dispatchFetch('https://elsewhere.test/api/sciencepal', { headers: { Cookie: sessionCookie }, redirect: 'manual' });
      assert.equal(otherHost.status, 401);
    });

    await t.test('logout needs confirmation and same-origin POST before clearing the cookie', async () => {
      const form = await request('/__crosslab/logout', { headers: { Cookie: sessionCookie, Accept: 'text/html' } });
      assert.equal(form.status, 200);
      assert.equal(form.headers.get('Referrer-Policy'), 'same-origin', 'logout uses the same native form behavior');
      assert.equal(form.headers.get('Set-Cookie'), null);
      assert.match(await form.text(), /method=["']post["']/i);
      for (const value of ['', 'https://attacker.test']) {
        const denied = await request('/__crosslab/logout', { method: 'POST', headers: { Cookie: sessionCookie, Origin: value } });
        assert.equal(denied.status, 403);
        assert.equal(denied.headers.get('Set-Cookie'), null);
      }
      const loggedOut = await request('/__crosslab/logout', { method: 'POST', headers: { Cookie: sessionCookie, Origin: origin } });
      assert.equal(loggedOut.status, 303);
      assert.equal(loggedOut.headers.get('Location'), '/__crosslab/login');
      assert.match(loggedOut.headers.get('Set-Cookie') || '', /Max-Age=0(?:;|$)/);
      assert.match(loggedOut.headers.get('Set-Cookie') || '', /HttpOnly/);
      assert.match(loggedOut.headers.get('Set-Cookie') || '', /Secure/);
    });

    assert.equal(outboundCalls, 0);
  } finally {
    await runtime.dispose();
  }
});

test('production Worker entry gates ASSETS and framework handlers before either is called', async () => {
  const entry = resolve('worker/index.ts').replaceAll('\\', '/');
  const bundled = await build({
    stdin: {
      contents: `
        import worker from ${JSON.stringify(entry)};
        globalThis.__frameworkCalls = 0;
        let assetCalls = 0;
        const env = {
          CROSSLAB_AUTH_REQUIRED: 'true',
          CROSSLAB_ACCESS_CODE: ${JSON.stringify(secret)},
          CROSSLAB_LOGIN_GUARD: {
            idFromName(name) { return name; },
            get() { return { async fetch() { return Response.json({ success: true, retryAfter: 0 }); } }; },
          },
          ASSETS: { async fetch(request) {
            assetCalls++;
            return new URL(request.url).pathname === '/assets/private.js'
              ? new Response('PRIVATE ASSET', { headers: { 'Cache-Control': 'public, max-age=86400' } })
              : new Response('Asset not found', { status: 404 });
          } },
        };
        export default { async fetch(request, bindings, ctx) {
          if (new URL(request.url).pathname === '/_test/stats') {
            return Response.json({ assetCalls, frameworkCalls: globalThis.__frameworkCalls });
          }
          return worker.fetch(request, env, ctx);
        }};
      `,
      resolveDir: process.cwd(), sourcefile: 'worker-entry-check.ts', loader: 'ts',
    },
    bundle: true, platform: 'neutral', format: 'esm', target: 'es2022',
    external: ['cloudflare:workers', 'node:*'], write: false, define: { 'import.meta.env.DEV': 'false' },
    plugins: [{
      name: 'test-framework-handler',
      setup(builder) {
        builder.onResolve({ filter: /^vinext\/server\/fetch-handler$/ }, () => ({ path: 'framework-handler', namespace: 'access-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'access-test' }, () => ({
          contents: `export default { async fetch() {
            globalThis.__frameworkCalls++;
            return new Response('PRIVATE FRAMEWORK', { headers: { 'Cache-Control': 'public, max-age=86400' } });
          }};`, loader: 'js',
        }));
      },
    }],
  });
  let outboundCalls = 0;
  const runtime = new Miniflare({
    modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    outboundService() {
      outboundCalls++;
      throw new Error('Entry tests must not contact external services');
    },
  });
  const request = (path, options = {}) => runtime.dispatchFetch(origin + path, { redirect: 'manual', ...options });
  const stats = async () => (await request('/_test/stats')).json();
  try {
    for (const path of ['/', '/api/sciencepal', '/assets/private.js']) {
      const response = await request(path);
      assert.equal(response.status, 401, path);
      assert.doesNotMatch(await response.text(), /PRIVATE (ASSET|FRAMEWORK)/);
    }
    assert.deepEqual(await stats(), { assetCalls: 0, frameworkCalls: 0 });
    const signedIn = await request('/__crosslab/login', {
      method: 'POST', body: new URLSearchParams({ code: secret }).toString(),
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.8' },
    });
    assert.equal(signedIn.status, 303);
    const cookie = signedIn.headers.get('Set-Cookie')?.split(';')[0];
    assert.ok(cookie);
    assert.deepEqual(await stats(), { assetCalls: 0, frameworkCalls: 0 });
    const asset = await request('/assets/private.js', { headers: { Cookie: cookie } });
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'PRIVATE ASSET');
    assert.equal(asset.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(await stats(), { assetCalls: 1, frameworkCalls: 0 });
    const page = await request('/', { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.equal(await page.text(), 'PRIVATE FRAMEWORK');
    assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(await stats(), { assetCalls: 2, frameworkCalls: 1 });
    const api = await request('/api/sciencepal', { headers: { Cookie: cookie } });
    assert.equal(api.status, 200);
    assert.equal(await api.text(), 'PRIVATE FRAMEWORK');
    assert.equal(api.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(await stats(), { assetCalls: 2, frameworkCalls: 2 });
    assert.equal(outboundCalls, 0);
  } finally {
    await runtime.dispose();
  }
});

test('SQLite login guard enforces a persistent five-attempt window under concurrent requests', async t => {
  const access = resolve('worker/access.ts').replaceAll('\\', '/');
  const counter = resolve('worker/access-rate-limit.ts').replaceAll('\\', '/');
  // Keep alarms in the future while the test advances a clock inside its own DO
  // subclass. No test clock or inspection endpoint is added to production code.
  const windowStart = Date.now() + 3_600_000;
  const bundled = await build({
    stdin: {
      contents: `
        import { withWebsiteAccess } from ${JSON.stringify(access)};
        import { LoginAttemptCounter } from ${JSON.stringify(counter)};
        export class TestLoginAttemptCounter extends LoginAttemptCounter {
          fetch(request) {
            const originalNow = Date.now;
            Date.now = () => Number(request.headers.get('x-test-now'));
            try { return super.fetch(request); }
            finally { Date.now = originalNow; }
          }
        }
        const calls = [];
        export default { async fetch(request, env) {
          const url = new URL(request.url);
          if (url.pathname === '/_test/stats') return Response.json(calls);
          const now = request.headers.get('x-test-now') || ${JSON.stringify(String(windowStart))};
          const namespace = {
            idFromName(name) {
              calls.push({ name });
              return env.CROSSLAB_LOGIN_GUARD.idFromName(name);
            },
            get(id) {
              const stub = env.CROSSLAB_LOGIN_GUARD.get(id);
              return { async fetch(input, init) {
                const forwarded = new Request(input, init);
                calls.push({ url: forwarded.url, method: forwarded.method,
                  headers: [...forwarded.headers], body: await forwarded.clone().text() });
                forwarded.headers.set('x-test-now', now);
                return stub.fetch(forwarded);
              }};
            }
          };
          return withWebsiteAccess(request, { CROSSLAB_AUTH_REQUIRED: 'true',
            CROSSLAB_ACCESS_CODE: ${JSON.stringify(secret)}, CROSSLAB_LOGIN_GUARD: namespace },
            async () => new Response('PRIVATE APPLICATION CONTENT'));
        }};
      `,
      resolveDir: process.cwd(), sourcefile: 'worker-persistent-login-check.ts', loader: 'ts',
    },
    bundle: true, platform: 'neutral', format: 'esm', target: 'es2022',
    external: ['cloudflare:workers', 'node:*'], write: false,
  });
  const persistence = await mkdtemp(resolve(tmpdir(), 'crosslab-login-tests-'));
  let outboundCalls = 0;
  const options = {
    name: 'crosslab-login-guard-test', modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CROSSLAB_LOGIN_GUARD: { className: 'TestLoginAttemptCounter', useSQLite: true } },
    durableObjectsPersist: persistence,
    outboundService() {
      outboundCalls++;
      throw new Error('Persistent login tests must not contact external services');
    },
  };
  let runtime = new Miniflare(options);
  const login = (ip, code = secret, now = windowStart, host = origin) => runtime.dispatchFetch(host + '/__crosslab/login', {
    method: 'POST', redirect: 'manual', body: new URLSearchParams({ code }).toString(),
    headers: { Origin: host, 'Content-Type': 'application/x-www-form-urlencoded',
      'CF-Connecting-IP': ip, 'x-test-now': String(now) },
  });
  const limitedIp = '198.51.100.41';
  try {
    await t.test('five concurrent wrong codes consume the window; the next correct code is blocked', async () => {
      const responses = await Promise.all(Array.from({ length: 12 }, () => login(limitedIp, 'incorrect-test-code')));
      assert.equal(responses.filter(response => response.status === 401).length, 5);
      assert.equal(responses.filter(response => response.status === 429).length, 7);
      assert.ok(responses.every(response => response.headers.get('Set-Cookie') === null));
      const blockedCorrect = await login(limitedIp);
      assert.equal(blockedCorrect.status, 429);
      assert.equal(blockedCorrect.headers.get('Retry-After'), '60');
      assert.equal(blockedCorrect.headers.get('Set-Cookie'), null);
      const independentIp = await login('198.51.100.42');
      assert.equal(independentIp.status, 303, 'another visitor has an independent attempt window');
    });

    await t.test('object names are keyed digests and the DO receives neither IP nor access code', async () => {
      const calls = await (await runtime.dispatchFetch(origin + '/_test/stats')).json();
      const names = calls.filter(call => 'name' in call).map(call => call.name);
      assert.equal(new Set(names.slice(0, 13)).size, 1, 'the same visitor resolves to one durable object');
      assert.notEqual(names[13], names[0], 'another visitor resolves to a different object');
      const digest = createHmac('sha256', secret).update('CrossLab login rate\n' + origin + '\n' + limitedIp).digest();
      assert.ok([digest.toString('hex'), digest.toString('base64url')].includes(names[0]), 'object identity uses the specified secret-keyed HMAC');
      for (const name of names) {
        assert.match(name, /^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{43})$/);
      }
      const serializedCalls = JSON.stringify(calls);
      assert.equal(serializedCalls.includes(limitedIp), false);
      assert.equal(serializedCalls.includes('198.51.100.42'), false);
      assert.equal(serializedCalls.includes(secret), false);
      assert.equal(serializedCalls.includes('incorrect-test-code'), false);
      const forwarded = calls.filter(call => 'url' in call);
      assert.ok(forwarded.length > 0);
      assert.ok(forwarded.every(call => call.method === 'POST' && call.body === ''));
      assert.ok(forwarded.every(call => call.headers.length === 0));
      assert.ok(forwarded.every(call => call.url === 'https://login-guard.internal/attempt'));
    });

    await t.test('SQLite count survives a workerd shutdown and replacement', async () => {
      await runtime.dispose();
      runtime = undefined;
      runtime = new Miniflare(options);
      const stillLimited = await login(limitedIp, secret, windowStart + 20_000);
      assert.equal(stillLimited.status, 429);
      assert.equal(stillLimited.headers.get('Retry-After'), '40');
      assert.equal(stillLimited.headers.get('Set-Cookie'), null);
    });

    await t.test('the window resets after sixty seconds and counts successful attempts too', async () => {
      const renewed = await Promise.all(Array.from({ length: 8 }, () => login(limitedIp, secret, windowStart + 60_001)));
      assert.equal(renewed.filter(response => response.status === 303).length, 5);
      assert.equal(renewed.filter(response => response.status === 429).length, 3);
      for (const response of renewed.filter(response => response.status === 303)) {
        assert.ok(response.headers.get('Set-Cookie')?.startsWith(cookieName + '='));
      }
      const blocked = await login(limitedIp, secret, windowStart + 119_000);
      assert.equal(blocked.status, 429);
      assert.equal(blocked.headers.get('Retry-After'), '2');
      const nextWindow = await login(limitedIp, secret, windowStart + 120_002);
      assert.equal(nextWindow.status, 303);
    });
    assert.equal(outboundCalls, 0);
  } finally {
    if (runtime) await runtime.dispose();
    assert.ok(resolve(persistence).startsWith(resolve(tmpdir()) + sep), 'only remove the test-specific temporary directory');
    await rm(persistence, { recursive: true, force: true });
  }
});
