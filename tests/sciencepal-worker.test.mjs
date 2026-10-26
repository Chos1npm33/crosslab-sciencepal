import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Use the runtime already shipped with the project's Wrangler dependency.
// This creates a local workerd instance, never deploys and makes no upstream calls.
const wranglerRequire = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');

test('production Worker supports ticket crypto, env bindings and the native fetch path', async () => {
  const source = resolve('server/lib/sciencepal.ts').replaceAll('\\', '/');
  const domain = resolve('lib/research.ts').replaceAll('\\', '/');
  const bundled = await build({
    stdin: { contents: `
      import { signSciencePalTicket, verifySciencePalTicket, sciencePalConfiguration, handleSciencePal, sciencePalRequestSchema } from ${JSON.stringify(source)};
      import { initialState, exampleProblem } from ${JSON.stringify(domain)};
      export default { async fetch() {
        const key = process.env.SCIENCEPAL_API_KEY;
        const ticket = { v: 1, scope: 'crosslab-sciencepal', action: 'analyze',
          inputFingerprint: '0'.repeat(64), inputRevision: 1,
          threadId: 'runtime-test-thread', runId: 'runtime-test-run',
          requestId: '8dbf754a-1313-4a79-afc2-e4532abf3245', knownRunIds: ['runtime-test-run'],
          phase: 'running', startedAt: new Date().toISOString(), expiresAt: Date.now() + 60000 };
        const signed = await signSciencePalTicket(ticket, key);
        const checked = await verifySciencePalTicket(signed, key);
        let tamperRejected = false;
        try { await verifySciencePalTicket(signed, 'other-test-key'); } catch { tamperRejected = true; }
        const native = await handleSciencePal(sciencePalRequestSchema.parse({
          op: 'start', action: 'analyze', requestId: '7c2925f8-d031-4873-a668-a09e047cf919',
          context: { ...initialState().context, problem: exampleProblem }
        }));
        return Response.json({ ready: sciencePalConfiguration().ready,
          threadMatches: checked.threadId === ticket.threadId,
          keyAbsent: !signed.includes(key), tamperRejected, nativeStatus: native.httpStatus });
      }};`, resolveDir: process.cwd(), sourcefile: 'sciencepal-worker-check.ts', loader: 'ts' },
    bundle: true, platform: 'neutral', format: 'esm', target: 'es2022',
    external: ['node:buffer'], write: false,
  });
  let outboundCalls = 0;
  const runtime = new Miniflare({ modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    bindings: { SCIENCEPAL_API_KEY: 'worker-test-key', SCIENCEPAL_AGENT_ID: 'worker-test-agent' },
    outboundService: request => {
      // Mock the official API at workerd's network boundary: no live service.
      outboundCalls++;
      assert.equal(request.url, 'https://sciencepal.ai/api/agent/initiate');
      assert.equal(request.headers.get('Authorization'), 'Bearer worker-test-key');
      return Response.json({ thread_id: 'mock-worker-thread', agent_run_id: 'mock-worker-run' });
    },
  });
  try {
    const response = await runtime.dispatchFetch('http://localhost/');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ready: true, threadMatches: true, keyAbsent: true, tamperRejected: true, nativeStatus: 202 });
    assert.equal(outboundCalls, 1);
  } finally { await runtime.dispose(); }
});
