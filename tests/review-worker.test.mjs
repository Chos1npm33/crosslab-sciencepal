import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const wranglerRequire = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');
const origin = 'https://crosslab.test';
const budgetName = 'sciencepal-budget-v1';
const signature = value => createHash('sha256').update(value).digest('hex');
const review = () => ({ role: 'review', visitorId: randomUUID() });
const submission = (identity, label = randomUUID()) => ({
  ...identity, requestId: randomUUID(), signature: signature(label),
});

// Two independent Worker entrypoints share one real SQLite Durable Object.
// The test-only clock exists in this bundle; production has no clock endpoint.
async function quotaHarness() {
  const source = resolve('worker/research-quota.ts').replaceAll('\\', '/');
  const bundled = await build({
    stdin: {
      contents: `
        import { ResearchQuota } from ${JSON.stringify(source)};
        export class TestResearchQuota extends ResearchQuota {
          testNow = 1_800_000_000_000;
          now() { return this.testNow; }
          async fetch(request) {
            const body = await request.text();
            this.testNow = Number(request.headers.get('x-test-now'));
            return super.fetch(new Request(request.url, {
              method: request.method, headers: request.headers, body: body || undefined,
            }));
          }
        }
        export default { fetch() { return new Response('Test storage worker'); } };
      `,
      resolveDir: process.cwd(), sourcefile: 'research-quota-check.ts', loader: 'ts',
    },
    bundle: true, platform: 'neutral', format: 'esm', target: 'es2022',
    external: ['cloudflare:workers', 'node:*'], write: false,
  });
  const gateway = `export default { async fetch(request, env) {
    const input = new URL(request.url);
    const name = request.headers.get('x-test-budget') || ${JSON.stringify(budgetName)};
    const stub = env.QUOTA.get(env.QUOTA.idFromName(name));
    return stub.fetch(new Request('https://quota.internal' + input.pathname, request));
  }};`;
  const persistence = await mkdtemp(resolve(tmpdir(), 'crosslab-quota-tests-'));
  let outboundCalls = 0;
  const common = {
    modules: true, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    outboundService() {
      outboundCalls++;
      throw new Error('Quota tests must not contact external services');
    },
  };
  const options = {
    durableObjectsPersist: persistence,
    workers: [
      ...['entry-a', 'entry-b'].map(name => ({
        ...common, name, script: gateway,
        durableObjects: { QUOTA: { className: 'TestResearchQuota', scriptName: 'quota-store', useSQLite: true } },
      })),
      { ...common, name: 'quota-store', script: bundled.outputFiles[0].text,
        durableObjects: { QUOTA: { className: 'TestResearchQuota', useSQLite: true } } },
    ],
  };
  let runtime = new Miniflare(options);
  let entries;
  async function connect() {
    entries = await Promise.all(['entry-a', 'entry-b'].map(name => runtime.getWorker(name)));
  }
  await connect();
  return {
    async post(path, value, { now = 1_800_000_000_000, entry = 0, budget = budgetName } = {}) {
      const response = await entries[entry].fetch(origin + path, {
        method: 'POST', redirect: 'manual', body: JSON.stringify(value),
        headers: { 'Content-Type': 'application/json', 'x-test-now': String(now), 'x-test-budget': budget },
      });
      const raw = await response.text();
      return { status: response.status, body: raw ? JSON.parse(raw) : null };
    },
    async restart() {
      await runtime.dispose();
      runtime = new Miniflare(options);
      await connect();
    },
    async dispose() {
      await runtime.dispose();
      assert.equal(outboundCalls, 0);
      assert.ok(resolve(persistence).startsWith(resolve(tmpdir()) + sep), 'remove only this test temporary directory');
      await rm(persistence, { recursive: true, force: true });
    },
  };
}

test('persistent research quotas serialize creation rights across independent Workers', async t => {
  const harness = await quotaHarness();
  const start = 1_800_000_000_000;
  const owner = { role: 'owner', visitorId: 'owner' };
  try {
    await t.test('invalid identity, request ID and signature never consume budget', async () => {
      const budget = 'validation';
      const identity = review();
      for (const input of [
        { ...submission(identity), role: 'owner' },
        { ...submission(identity), visitorId: 'owner' },
        { ...submission(identity), requestId: 'not-a-uuid' },
        { ...submission(identity), signature: 'not-a-sha256-digest' },
      ]) {
        assert.equal((await harness.post('/reserve', input, { budget })).status, 400);
      }
      const status = await harness.post('/status', identity, { budget });
      assert.equal(status.status, 200);
      assert.equal(status.body.quota.totalUsed, 0);
      assert.equal(status.body.quota.visitorUsed, 0);
    });

    await t.test('forty concurrent visitors receive exactly thirty creation grants globally', async () => {
      const results = await Promise.all(Array.from({ length: 40 }, (_, index) =>
        harness.post('/reserve', submission(review()), { entry: index % 2 })));
      const grants = results.filter(result => result.body.kind === 'dispatch');
      const denied = results.filter(result => result.status === 429);
      assert.equal(grants.length, 30);
      assert.equal(new Set(grants.map(result => result.body.claim)).size, 30);
      assert.equal(denied.length, 10);
      assert.ok(denied.every(result => result.body.code === 'quota_total_exhausted'));
      assert.ok(results.every(result => result.body.quota.totalUsed <= 30));
      const freshCookie = await harness.post('/reserve', submission(review()));
      assert.equal(freshCookie.status, 429, 'a newly issued browser identity cannot reset the site budget');
      const ownerAttempt = await harness.post('/reserve', submission(owner));
      assert.equal(ownerAttempt.body.code, 'quota_total_exhausted', 'owner calls share the global budget');
    });

    await t.test('a browser gets one grant per rolling minute and at most eight total', async () => {
      const budget = 'browser-limit';
      const identity = review();
      const initial = await Promise.all(Array.from({ length: 6 }, (_, index) =>
        harness.post('/reserve', submission(identity), { budget, entry: index % 2 })));
      assert.equal(initial.filter(result => result.body.kind === 'dispatch').length, 1);
      assert.equal(initial.filter(result => result.body.code === 'quota_cooldown').length, 5);
      const premature = await harness.post('/reserve', submission(identity), { budget, now: start + 59_999 });
      assert.equal(premature.body.code, 'quota_cooldown');
      assert.equal(premature.body.quota.retryAfterSeconds, 1);
      for (let attempt = 1; attempt < 8; attempt++) {
        const result = await harness.post('/reserve', submission(identity), { budget, now: start + attempt * 60_000 });
        assert.equal(result.body.kind, 'dispatch', `accepted browser attempt ${attempt + 1}`);
        assert.equal(result.body.quota.visitorUsed, attempt + 1);
      }
      const ninth = await harness.post('/reserve', submission(identity), { budget, now: start + 8 * 60_000 });
      assert.equal(ninth.status, 429);
      assert.equal(ninth.body.code, 'quota_visitor_exhausted');
      assert.equal(ninth.body.quota.totalUsed, 8);
      assert.equal(ninth.body.quota.visitorRemaining, 0);
      const otherVisitor = await harness.post('/reserve', submission(review()), { budget, now: start + 8 * 60_000 });
      assert.equal(otherVisitor.body.kind, 'dispatch');
    });

    await t.test('owner grants have no browser cap or cooldown but still stop at thirty', async () => {
      const budget = 'owner-limit';
      const responses = await Promise.all(Array.from({ length: 32 }, (_, index) =>
        harness.post('/reserve', submission(owner), { budget, entry: index % 2 })));
      assert.equal(responses.filter(result => result.body.kind === 'dispatch').length, 30);
      assert.equal(responses.filter(result => result.body.code === 'quota_total_exhausted').length, 2);
      assert.ok(responses.every(result => result.body.quota.retryAfterSeconds === 0));
    });

    await t.test('concurrent retries get one dispatch right and pending receipts remain occupied', async () => {
      const budget = 'idempotency';
      const identity = review();
      const input = submission(identity);
      const responses = await Promise.all(Array.from({ length: 12 }, (_, index) =>
        harness.post('/reserve', input, { budget, entry: index % 2 })));
      const dispatched = responses.filter(result => result.body.kind === 'dispatch');
      assert.equal(dispatched.length, 1);
      assert.equal(responses.filter(result => result.body.code === 'request_inflight').length, 11);
      assert.ok(responses.every(result => result.body.quota.totalUsed === 1));
      const later = await harness.post('/reserve', input, { budget, now: start + 86_400_000 });
      assert.equal(later.status, 409, 'unknown submissions never expire into a second dispatch');
      assert.equal(later.body.code, 'request_inflight');
      assert.equal(later.body.status, 'unknown');
      assert.equal(later.body.quota.totalUsed, 1);
      const otherContent = await harness.post('/reserve', { ...input, signature: signature('changed-input') }, { budget });
      assert.equal(otherContent.body.code, 'request_conflict');
      const otherBrowser = await harness.post('/reserve', { ...input, ...review() }, { budget });
      assert.equal(otherBrowser.body.code, 'request_conflict');
      const response = { httpStatus: 202, body: { status: 'running', runId: 'fake-run', ticket: 'fake-signed-ticket' } };
      const completion = { ...identity, requestId: input.requestId, claim: dispatched[0].body.claim, response };
      const wrongClaim = await harness.post('/complete', { ...completion, claim: randomUUID() }, { budget });
      assert.equal(wrongClaim.body.code, 'receipt_mismatch');
      const wrongBrowser = await harness.post('/complete', { ...completion, ...review() }, { budget });
      assert.equal(wrongBrowser.body.code, 'receipt_mismatch');
      const saved = await harness.post('/complete', completion, { budget });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.ok, true);
      const savedAgain = await harness.post('/complete', completion, { budget });
      assert.equal(savedAgain.status, 200, 'saving the same receipt is idempotent');
      const conflicting = await harness.post('/complete', { ...completion, response: { httpStatus: 202, body: { runId: 'different-run' } } }, { budget });
      assert.equal(conflicting.body.code, 'receipt_conflict');
      const replay = await harness.post('/reserve', input, { budget });
      assert.equal(replay.body.kind, 'replay');
      assert.deepEqual(replay.body.response, response);
      assert.equal(replay.body.quota.totalUsed, 1);
      assert.equal(replay.body.quota.visitorUsed, 1);
    });

    await t.test('success, unknown reservations and an exhausted global budget survive workerd restart', async () => {
      const budget = 'restart';
      const identity = review();
      const successful = submission(identity);
      const grant = await harness.post('/reserve', successful, { budget });
      const response = { httpStatus: 202, body: { status: 'running', runId: 'persisted-run' } };
      assert.equal((await harness.post('/complete', { ...identity, requestId: successful.requestId, claim: grant.body.claim, response }, { budget })).status, 200);
      const unknown = submission(identity);
      assert.equal((await harness.post('/reserve', unknown, { budget, now: start + 60_000 })).body.kind, 'dispatch');
      await harness.restart();
      const exhausted = await harness.post('/status', review());
      assert.equal(exhausted.body.quota.totalUsed, 30);
      assert.equal(exhausted.body.quota.totalRemaining, 0);
      const replay = await harness.post('/reserve', successful, { budget, now: start + 80_000, entry: 1 });
      assert.equal(replay.body.kind, 'replay');
      assert.deepEqual(replay.body.response, response);
      const pending = await harness.post('/reserve', unknown, { budget, now: start + 80_000, entry: 0 });
      assert.equal(pending.body.code, 'request_inflight');
      assert.equal(pending.body.quota.totalUsed, 2);
      const cooldown = await harness.post('/reserve', submission(identity), { budget, now: start + 80_000 });
      assert.equal(cooldown.body.code, 'quota_cooldown');
      assert.equal(cooldown.body.quota.retryAfterSeconds, 40);
      const third = await harness.post('/reserve', submission(identity), { budget, now: start + 120_000 });
      assert.equal(third.body.kind, 'dispatch');
      assert.equal(third.body.quota.totalUsed, 3);
    });

    await t.test('status reads never consume or refresh a reservation window', async () => {
      const budget = 'read-only-status';
      const identity = review();
      const created = await harness.post('/reserve', submission(identity), { budget });
      assert.equal(created.body.kind, 'dispatch');
      const statuses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        harness.post('/status', identity, { budget, now: start + 30_000, entry: index % 2 })));
      assert.ok(statuses.every(result => result.body.quota.totalUsed === 1 && result.body.quota.visitorUsed === 1));
      assert.ok(statuses.every(result => result.body.quota.retryAfterSeconds === 30));
      const next = await harness.post('/reserve', submission(identity), { budget, now: start + 60_000 });
      assert.equal(next.body.kind, 'dispatch');
      assert.equal(next.body.quota.totalUsed, 2);
    });
  } finally {
    await harness.dispose();
  }
});

