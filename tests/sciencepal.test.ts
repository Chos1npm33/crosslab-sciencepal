import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, GET } from '../app/api/sciencepal/route';
import { GET as workflowConfig, POST as workflowPost } from '../app/api/workflow/route';
import { signSciencePalTicket, verifySciencePalTicket, type SciencePalTicket } from '../server/lib/sciencepal';
import { initialState, exampleProblem, fingerprint, type Context, runMetaSchema, resultSchema } from '../lib/research';
import { analyze, deepResearch } from '../lib/demo-provider';

const key = 'test-only-sciencepal-key';
process.env.SCIENCEPAL_API_KEY = key;
process.env.SCIENCEPAL_AGENT_ID = 'agent-test';
function context(): Context { const c = { ...initialState().context, problem: { ...exampleProblem } }; const a = analyze(c); return { ...c, papers: a.papers, mappings: a.mappings }; }
function request(body: unknown) { return new Request('http://localhost/api/sciencepal', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
async function ticket(c: Context, patch: Partial<SciencePalTicket> = {}) { return { v: 1 as const, scope: 'crosslab-sciencepal' as const, action: 'analyze' as const, inputFingerprint: await fingerprint(c), inputRevision: c.revision, threadId: 'thread-test', runId: 'run-test', requestId: '8dbf754a-1313-4a79-afc2-e4532abf3245', knownRunIds: ['run-test'], phase: 'running' as const, startedAt: '2026-10-24T00:00:00.000Z', expiresAt: Date.now() + 3600000, ...patch }; }
type Body = { status?: string; ticket?: string; runId?: string; threadId?: string; question?: string; data?: unknown; meta?: unknown; code?: string; ready?: boolean; hasApiKey?: boolean; mode?: string };
async function body(response: Response) { return await response.json() as Body; }
function apiPath(input: string | URL | Request) { return new URL(input instanceof Request ? input.url : String(input)).pathname; }
async function withFetch(run: (set: (handler: typeof fetch) => void) => Promise<void>) { const original = globalThis.fetch; try { await run(handler => { globalThis.fetch = handler; }); } finally { globalThis.fetch = original; } }

test('SciencePal configuration reports readiness without secrets and selects async endpoint', async () => {
  const old = process.env.RESEARCH_PROVIDER;
  process.env.RESEARCH_PROVIDER = 'sciencepal';
  try {
    const status = await GET(); const contents = await status.text();
    assert.doesNotMatch(contents, /test-only-sciencepal-key|agent-test/);
    assert.equal((await body(await workflowConfig())).mode, 'sciencepal');
    assert.equal((await workflowPost(request({}))).status, 409);
    delete process.env.SCIENCEPAL_API_KEY;
    assert.equal((await body(await GET())).ready, false);
  } finally { process.env.SCIENCEPAL_API_KEY = key; if (old === undefined) delete process.env.RESEARCH_PROVIDER; else process.env.RESEARCH_PROVIDER = old; }
});

test('ticket signature binds all run fields and rejects tampering or key changes', async () => {
  const t = await ticket(context()); const signed = await signSciencePalTicket(t, key);
  assert.deepEqual(await verifySciencePalTicket(signed, key), t);
  await assert.rejects(verifySciencePalTicket(signed, 'different-key'));
  const split = signed.split('.');
  split[0] = Buffer.from(JSON.stringify({ ...t, threadId: 'foreign-thread' })).toString('base64url');
  await assert.rejects(verifySciencePalTicket(split.join('.'), key));
  await assert.rejects(verifySciencePalTicket(await signSciencePalTicket({ ...t, expiresAt: 1 }, key), key));
});

test('native start uses the official form endpoint once and returns a signed polling ticket', async () => {
  await withFetch(async set => {
    const calls: string[] = [];
    const requestId = crypto.randomUUID();
    set(async (url, init) => {
      calls.push(String(url));
      assert.equal(String(url), 'https://sciencepal.ai/api/agent/initiate');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'manual');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), `Bearer ${key}`);
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get('agent_id'), 'agent-test');
      assert.equal(form.get('agent_select_type'), 'manual');
      assert.equal(form.get('stream'), 'true');
      assert.match(form.get('prompt') || '', new RegExp(`/workspace/crosslab/${requestId}.json`));
      assert.doesNotMatch(form.get('prompt') || '', /test-only-sciencepal-key/);
      return Response.json({ thread_id: 'thread-test', agent_run_id: 'run-test' });
    });
    const response = await POST(request({ op: 'start', action: 'analyze', context: context(), requestId }));
    assert.equal(response.status, 202);
    const returned = await body(response);
    assert.equal(returned.status, 'running');
    assert.equal((await verifySciencePalTicket(returned.ticket!, key)).requestId, requestId);
    assert.equal(calls.length, 1);
  });
});

test('unconfirmed deep research and modified polling inputs are rejected before HTTP calls', async () => {
  await withFetch(async set => {
    let calls = 0; set(async () => { calls++; throw new Error('must not fetch'); });
    const c = context();
    assert.equal((await POST(request({ op: 'start', action: 'deep', context: c }))).status, 409);
    const signed = await signSciencePalTicket(await ticket(c), key);
    assert.equal((await POST(request({ op: 'poll', ticket: signed, context: { ...c, canCollect: false } }))).status, 409);
    assert.equal(calls, 0);
  });
});

test('poll reads completed output through official sandbox endpoints and returns source metadata', async () => {
  await withFetch(async set => {
    const c = context(); const t = await ticket(c);
    const paths: string[] = [];
    set(async url => {
      const path = apiPath(url); paths.push(path);
      if (path === '/api/agent-run/run-test') return Response.json({ id: 'run-test', threadId: 'thread-test', status: 'completed', completedAt: '2026-10-24T01:02:03+08:00' });
      if (path === '/api/thread/thread-test/sandbox') return Response.json({ thread_id: 'thread-test', project_id: 'project-test', sandbox_id: 'sandbox-test' });
      if (path === '/api/sandboxes/sandbox-test/files/content') {
        assert.equal(new URL(String(url)).searchParams.get('path'), `/workspace/crosslab/${t.requestId}.json`);
        return Response.json({ schemaVersion: 1, requestId: t.requestId, action: t.action, contextFingerprint: t.inputFingerprint, status: 'completed', data: analyze(c) });
      }
      throw new Error('unexpected endpoint');
    });
    const response = await POST(request({ op: 'poll', ticket: await signSciencePalTicket(t, key), context: c }));
    assert.equal(response.status, 200);
    const returned = await body(response);
    assert.equal(returned.status, 'completed');
    const meta = runMetaSchema.parse(returned.meta);
    assert.equal(meta.provider, 'sciencepal');
    assert.equal(meta.upstream?.projectUrl, 'https://sciencepal.ai/projects/project-test/thread/thread-test');
    assert.equal(meta.upstream?.completedAt, '2026-10-23T17:02:03.000Z');
    assert.equal((await verifySciencePalTicket(returned.ticket!, key)).phase, 'completed');
    assert.equal(paths.length, 3);
  });
});

test('running poll only queries status and never starts work', async () => {
  await withFetch(async set => {
    const c = context(); let calls = 0;
    set(async (url, init) => { calls++; assert.equal(apiPath(url), '/api/agent-run/run-test'); assert.equal(init?.method, undefined); return Response.json({ id: 'run-test', status: 'running' }); });
    const response = await POST(request({ op: 'poll', ticket: await signSciencePalTicket(await ticket(c), key), context: c }));
    assert.equal(response.status, 202);
    assert.equal((await body(response)).status, 'running');
    assert.equal(calls, 1);
  });
});

test('asked reply starts an independent task with the signed question and complete history', async () => {
  await withFetch(async set => {
    const c = context(); const t = await ticket(c); const messageId = crypto.randomUUID();
    const mutations: string[] = [];
    set(async (url, init) => {
      const path = apiPath(url);
      if (path === '/api/agent-run/run-test') return Response.json({ id: 'run-test', status: 'asked' });
      if (path === '/api/thread/thread-test/sandbox') return Response.json({ thread_id: 'thread-test', project_id: 'project-test', sandbox_id: 'sandbox-test' });
      if (path.endsWith('/files/content')) return Response.json({ schemaVersion: 1, requestId: t.requestId, action: 'analyze', contextFingerprint: t.inputFingerprint, status: 'asked', question: '样本是单细胞还是 bulk？' });
      if (init?.method === 'POST') mutations.push(path);
      if (path === '/api/agent/initiate') {
        const prompt = new URLSearchParams(String(init?.body)).get('prompt') || '';
        assert.match(prompt, /样本是单细胞还是 bulk/); assert.match(prompt, /是 bulk 样本/);
        assert.match(prompt, /早前条件/); assert.match(prompt, /完整历史/);
        assert.match(prompt, /当前context是当前研究条件/);
        return Response.json({ thread_id: 'new-reply-thread', agent_run_id: 'run-next' });
      }
      throw new Error('unexpected endpoint');
    });
    const asked = await body(await POST(request({ op: 'poll', ticket: await signSciencePalTicket(t, key), context: c })));
    assert.equal(asked.status, 'asked');
    assert.equal(asked.question, '样本是单细胞还是 bulk？');
    const next = await POST(request({ op: 'reply', ticket: asked.ticket, context: c, message: '是 bulk 样本', messageId, question: '客户端篡改的问题', clarifications: [{question: '早前条件',answer: '完整历史'}] }));
    assert.equal(next.status, 202);
    const returned = await body(next);
    assert.equal(returned.threadId, 'new-reply-thread');
    assert.equal(returned.runId, 'run-next');
    assert.deepEqual(mutations, ['/api/agent/initiate']);
    assert.equal((await verifySciencePalTicket(returned.ticket!, key)).previousRun?.threadId, 'thread-test');
  });
});

test('completed ticket permits revised context in a new stage task with lineage', async () => {
  await withFetch(async set => {
    const c = context(); const prior = await ticket(c, { phase: 'completed' });
    const changed = { ...c, revision: 2, sampleType: 'timeSeries' as const };
    const messageId = crypto.randomUUID();
    set(async (url, init) => {
      const path = apiPath(url);
      if (path === '/api/agent-run/run-test') return Response.json({ id: 'run-test', status: 'completed' });
      assert.equal(path, '/api/agent/initiate');
      assert.equal(init?.method, 'POST');
      assert.equal(new URLSearchParams(String(init?.body)).get('web_search_on'), 'false');
      return Response.json({ thread_id: 'new-plan-thread', agent_run_id: 'run-plan' });
    });
    const response = await POST(request({ op: 'start', priorTicket: await signSciencePalTicket(prior, key), messageId, action: 'plan', context: changed }));
    assert.equal(response.status, 202);
    const saved = await verifySciencePalTicket((await body(response)).ticket!, key);
    assert.equal(saved.threadId, 'new-plan-thread');
    assert.equal(saved.previousRun?.threadId, prior.threadId);
    assert.equal(saved.action, 'plan');
    assert.equal(saved.inputFingerprint, await fingerprint(changed));
  });
});

test('initial start timeout is reported as unknown and never automatically retried', async () => {
  await withFetch(async set => {
    let calls = 0;
    set(async () => { calls++; throw new DOMException('timeout', 'TimeoutError'); });
    const response = await POST(request({ op: 'start', action: 'analyze', context: context() }));
    assert.equal(response.status, 504);
    assert.equal((await body(response)).code, 'initiate_unknown');
    assert.equal(calls, 1);
  });
});

test('an initiate receipt without a run ID is reconciled once and retains a recoverable ticket', async () => {
  await withFetch(async set => {
    const mutations: string[] = [];
    let hasRun = false;
    set(async (url, init) => {
      const path = apiPath(url);
      if (init?.method === 'POST') { mutations.push(path); return Response.json({ thread_id: 'thread-test', agent_run_id: null }); }
      assert.equal(path, '/api/thread/thread-test/agent-runs');
      return Response.json({ agent_runs: hasRun ? [{ id: 'run-discovered', thread_id: 'thread-test' }] : [] });
    });
    const c = context();
    const initial = await POST(request({ op: 'start', action: 'analyze', context: c, requestId: crypto.randomUUID() }));
    assert.equal(initial.status, 409);
    const unknown = await body(initial);
    assert.equal(unknown.code, 'start_unknown');
    assert.equal((await verifySciencePalTicket(unknown.ticket!, key)).runId, null);
    hasRun = true;
    set(async (url, init) => {
      assert.equal(init?.method, undefined);
      if (apiPath(url).endsWith('/agent-runs')) return Response.json({ agent_runs: [{ id: 'run-discovered', thread_id: 'thread-test' }] });
      assert.equal(apiPath(url), '/api/agent-run/run-discovered');
      return Response.json({ id: 'run-discovered', threadId: 'thread-test', status: 'running' });
    });
    const recovered = await body(await POST(request({ op: 'poll', ticket: unknown.ticket, context: c })));
    assert.equal(recovered.status, 'running');
    assert.equal(recovered.runId, 'run-discovered');
    assert.deepEqual(mutations, ['/api/agent/initiate']);
  });
});

test('poll updates an asked ticket when the official run has resumed', async () => {
  await withFetch(async set => {
    const c = context(); const prior = await ticket(c, { phase: 'asked' });
    set(async () => Response.json({ id: 'run-test', status: 'running' }));
    const returned = await body(await POST(request({ op: 'poll', ticket: await signSciencePalTicket(prior, key), context: c })));
    assert.equal(returned.status, 'running');
    assert.equal((await verifySciencePalTicket(returned.ticket!, key)).phase, 'running');
  });
});

test('a question artifact from another request is rejected without reading fallback text', async () => {
  await withFetch(async set => {
    const c = context(); const t = await ticket(c); let streamCalls = 0;
    set(async url => {
      const path = apiPath(url);
      if (path === '/api/agent-run/run-test') return Response.json({ id: 'run-test', status: 'asked' });
      if (path.endsWith('/sandbox')) return Response.json({ thread_id: 'thread-test', project_id: 'project-test', sandbox_id: 'sandbox-test' });
      if (path.endsWith('/files/content')) return Response.json({ schemaVersion: 1, requestId: crypto.randomUUID(), action: 'analyze', contextFingerprint: t.inputFingerprint, status: 'asked', question: '其他请求的问题' });
      streamCalls++; throw new Error('must not read fallback stream');
    });
    const response = await POST(request({ op: 'poll', ticket: await signSciencePalTicket(t, key), context: c }));
    assert.equal(response.status, 409);
    assert.equal((await body(response)).code, 'artifact_mismatch');
    assert.equal(streamCalls, 0);
  });
});

test('deep polling rechecks confirmation and rejects an artifact with foreign citation IDs', async () => {
  await withFetch(async set => {
    const c = context(); const t = await ticket(c, { action: 'deep' });
    let calls = 0;
    set(async url => {
      calls++;
      const path = apiPath(url);
      if (path === '/api/agent-run/run-test') return Response.json({ id: 'run-test', status: 'completed' });
      if (path.endsWith('/sandbox')) return Response.json({ thread_id: 'thread-test', project_id: 'project-test', sandbox_id: 'sandbox-test' });
      return Response.json({ schemaVersion: 1, requestId: t.requestId, action: 'deep', contextFingerprint: t.inputFingerprint, status: 'completed', data: { fingerprint: t.inputFingerprint, hypothesis: '待验证假说', findings: [{ title: '来源检查', body: '文献事实', kind: 'evidence', sourceIds: ['FOREIGN'] }], experiment: [], next: ['核查'], completedAt: new Date().toISOString() } });
    });
    const signed = await signSciencePalTicket(t, key);
    assert.equal((await POST(request({ op: 'poll', ticket: signed, context: c }))).status, 409);
    assert.equal(calls, 0);
    const response = await POST(request({ op: 'poll', ticket: signed, context: c, confirmation: { approved: true, fingerprint: t.inputFingerprint, at: new Date().toISOString() } }));
    assert.equal(response.status, 502);
    assert.equal((await body(response)).code, 'invalid_citations');
  });
});

test('old unknown tickets remain pollable without initiating a replacement task', async () => {
  await withFetch(async set => {
    const c = context(); const prior = await ticket(c, { phase: 'unknown', runId: null });
    let calls = 0;
    set(async (url, init) => { calls++; assert.equal(init?.method, undefined); return apiPath(url).endsWith('/agent-runs') ? Response.json({ agent_runs: [{ id: 'run-test' }, { id: 'run-after-timeout' }] }) : Response.json({id:'run-after-timeout',status:'running'}); });
    const response = await POST(request({ op: 'poll', ticket: await signSciencePalTicket(prior, key), context: c }));
    assert.equal(response.status, 202);
    assert.equal((await body(response)).runId, 'run-after-timeout');
    assert.equal(calls, 2);
  });
});

test('completed run without its artifact is reported explicitly rather than substituted with demo', async () => {
  await withFetch(async set => {
    const c = context();
    set(async url => apiPath(url).includes('/agent-run/') ? Response.json({ id: 'run-test', status: 'completed' }) : new Response('missing', { status: 404 }));
    const response = await POST(request({ op: 'poll', ticket: await signSciencePalTicket(await ticket(c), key), context: c }));
    assert.equal(response.status, 502);
    const returned = await body(response);
    assert.equal(returned.code, 'artifact_unavailable');
    assert.equal(returned.data, undefined);
  });
});

test('official nullable run-list fields do not prevent recovery', async () => {
  await withFetch(async set => {
    const c = context(); const t = await ticket(c, { runId: null, phase: 'unknown', knownRunIds: [] });
    set(async url => apiPath(url).endsWith('/agent-runs')
      ? Response.json({ agent_runs: [{ id: null, thread_id: null, status: null }, { id: 'run-nullable', thread_id: null, status: null }] })
      : Response.json({ id: 'run-nullable', status: 'running' }));
    const response = await POST(request({ op: 'poll', ticket: await signSciencePalTicket(t, key), context: c }));
    assert.equal(response.status, 202);
    assert.equal((await body(response)).runId, 'run-nullable');
  });
});

test('a known thread keeps its signed ticket when the initial run-list query fails', async () => {
  await withFetch(async set => {
    let writes = 0;
    set(async (_, init) => {
      if (init?.method === 'POST') { writes++; return Response.json({ thread_id: 'known-thread' }); }
      throw new DOMException('timeout', 'TimeoutError');
    });
    const response = await POST(request({ op: 'start', action: 'analyze', context: context(), requestId: crypto.randomUUID() }));
    const returned = await body(response);
    assert.equal(returned.code, 'start_unknown');
    assert.equal((await verifySciencePalTicket(returned.ticket!, key)).threadId, 'known-thread');
    assert.equal(writes, 1);
  });
});

test('continuation cannot overwrite an earlier result path by reusing its message ID', async () => {
  await withFetch(async set => {
    let writes = 0; set(async (_, init) => { if(init?.method === 'POST') writes++; return Response.json({id:'run-test',status:'completed'}); });
    const c = context(); const earlierId = crypto.randomUUID();
    const t = await ticket(c, { phase: 'completed', requestIds: [earlierId, '8dbf754a-1313-4a79-afc2-e4532abf3245'] });
    const response = await POST(request({ op: 'start', action: 'analyze', priorTicket: await signSciencePalTicket(t, key), context: c, messageId: earlierId }));
    assert.equal((await body(response)).code, 'message_id_reused');
    assert.equal(writes, 0);
  });
});

test('asked without an artifact retains an SDK stream question for the new reply task', async () => {
  await withFetch(async set => {
    const c = context(); const t = await ticket(c); const messageId = crypto.randomUUID();
    set(async (url, init) => {
      const path = apiPath(url);
      if (path === '/api/agent-run/run-test') return Response.json({ id: 'run-test', status: 'asked' });
      if (path.endsWith('/sandbox')) return new Response('missing', { status: 404 });
      if (path.endsWith('/stream')) return new Response('data: {"type":"message","content":"是否可以补采样？"}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      assert.equal(path, '/api/agent/initiate');
      assert.match(new URLSearchParams(String(init?.body)).get('prompt') || '', /是否可以补采样/);
      return Response.json({ thread_id:'question-reply-thread', agent_run_id: 'run-after-question' });
    });
    const asked = await body(await POST(request({ op: 'poll', ticket: await signSciencePalTicket(t, key), context: c })));
    assert.equal(asked.status, 'asked');
    assert.equal(asked.question, '是否可以补采样？');
    const reply = await POST(request({ op: 'reply', ticket: asked.ticket, context: c, messageId, message: '可以补充三个时期。' }));
    assert.equal(reply.status, 202);
    assert.equal((await body(reply)).runId, 'run-after-question');
  });
});

test('same-process concurrent and replayed initiate requests do not start duplicate runs', async () => {
  await withFetch(async set => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let arrived!: () => void; const started = new Promise<void>(resolve => { arrived = resolve; });
    let writes = 0;
    set(async () => { writes++; arrived(); await gate; return Response.json({ thread_id: 'dedupe-thread', agent_run_id: 'dedupe-run' }); });
    const input = { op: 'start', action: 'analyze', context: context(), requestId: crypto.randomUUID() };
    const first = POST(request(input)); await started;
    assert.equal((await body(await POST(request(input)))).code, 'request_inflight');
    release(); const accepted = await body(await first);
    const replayed = await body(await POST(request(input)));
    assert.equal(replayed.ticket, accepted.ticket);
    assert.equal(writes, 1);
    assert.equal((await body(await POST(request({ ...input, context: { ...input.context, canCollect: false } })))).code, 'request_conflict');
  });
});

test('same-process replay of a timed-out initiate never repeats its mutation', async () => {
  await withFetch(async set => {
    let writes = 0; set(async () => { writes++; throw new DOMException('timeout', 'TimeoutError'); });
    const input = { op: 'start', action: 'analyze', context: context(), requestId: crypto.randomUUID() };
    assert.equal((await body(await POST(request(input)))).code, 'initiate_unknown');
    assert.equal((await body(await POST(request(input)))).code, 'initiate_unknown');
    assert.equal(writes, 1);
  });
});

test('one live process permits only one concurrent next task per prior run', async () => {
  await withFetch(async set => {
    const c = context(); const t = await ticket(c, { phase: 'asked', threadId: 'locked-thread', question:'补充什么条件？' });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let arrived!: () => void; const started = new Promise<void>(resolve => { arrived = resolve; });
    let mutations = 0;
    const firstId = crypto.randomUUID();
    set(async (url, init) => {
      const path = apiPath(url);
      if (path === '/api/agent-run/run-test') { arrived(); await gate; return Response.json({ id:'run-test', threadId:'locked-thread', status:'asked' }); }
      if (init?.method === 'POST') mutations++;
      assert.equal(path,'/api/agent/initiate');
      return Response.json({ thread_id:'locked-new-thread', agent_run_id: 'locked-next' });
    });
    const base = { op: 'reply', context: c, ticket: await signSciencePalTicket(t, key), message: '补充信息' };
    const first = POST(request({ ...base, messageId: firstId })); await started;
    assert.equal((await body(await POST(request({ ...base, messageId: crypto.randomUUID() })))).code, 'thread_busy');
    release(); assert.equal((await first).status, 202);
    assert.equal(mutations, 1);
  });
});

test('native prompts keep planning, deep review and evaluation within their approved stage', async () => {
  await withFetch(async set => {
    const c = context(); const fp = await fingerprint(c);
    const confirmation = { approved: true, fingerprint: fp, at: new Date().toISOString() };
    const result = await deepResearch(c);
    const prompts: string[] = [];
    set(async (_, init) => {
      prompts.push(new URLSearchParams(String(init?.body)).get('prompt') || '');
      return Response.json({ thread_id: crypto.randomUUID(), agent_run_id: crypto.randomUUID() });
    });
    for (const action of ['analyze', 'plan', 'deep', 'evaluate']) {
      assert.equal((await POST(request({ op: 'start', action, context: c, confirmation, result, requestId: crypto.randomUUID() }))).status, 202);
    }
    assert.match(prompts[0], /双侧文献检索.*迁移审查/);
    assert.match(prompts[1], /不执行深研，不重复全量文献检索/);
    assert.match(prompts[1], /JSON 总计不超过 4000 字/);
    assert.match(prompts[1], /等待用户确认/);
    assert.match(prompts[1], /通常直接交付带未知条件的待确认计划/);
    assert.match(prompts[2], /定向证据审查/);
    assert.match(prompts[2], /证据来源限定为 context\.papers/);
    assert.match(prompts[2], /只完成文献证据与方法设计审查/);
    assert.match(prompts[2], /不因缺数据反复追问/);
    assert.match(prompts[2], /只有必须由用户选择才能确定任务范围/);
    assert.match(prompts[3], /可行性、创新性、证据完整性、可验证性、资源匹配/);
    assert.match(prompts[3], /不再发起新研究或新检索/);
  });
});

test('failed continuation preflight makes no writes and permits the same request ID after recovery', async () => {
  await withFetch(async set => {
    const c = context(); const prior = await ticket(c, { phase: 'completed', threadId: 'preflight-thread' });
    const messageId = crypto.randomUUID();
    const input = { op: 'start', action: 'plan', context: c, priorTicket: await signSciencePalTicket(prior, key), messageId };
    let writes = 0;
    set(async (_, init) => { if (init?.method === 'POST') writes++; throw new TypeError('network unavailable'); });
    const failed = await POST(request(input));
    assert.equal((await body(failed)).code, 'preflight_failed');
    assert.equal(writes, 0);
    set(async (url, init) => {
      assert.equal(init?.redirect, 'manual');
      const path = apiPath(url);
      if (path === '/api/agent-run/run-test') return Response.json({ id:'run-test', threadId:'preflight-thread', status:'completed' });
      writes++;
      assert.equal(path,'/api/agent/initiate');
      return Response.json({ thread_id:'recovered-new-thread', agent_run_id: 'preflight-recovered' });
    });
    assert.equal((await POST(request(input))).status, 202);
    assert.equal(writes, 1);
  });
});

test('native reads reject redirects without following them or forwarding credentials', async () => {
  await withFetch(async set => {
    const c = context(); let calls = 0;
    set(async (url, init) => {
      calls++; assert.equal(init?.redirect, 'manual');
      assert.equal(new URL(String(url)).origin, 'https://sciencepal.ai');
      return new Response(null, { status: 302, headers: { Location: 'https://other.example/result' } });
    });
    const response = await POST(request({ op: 'poll', context: c, ticket: await signSciencePalTicket(await ticket(c), key) }));
    assert.equal((await body(response)).code, 'redirect_blocked');
    assert.equal(calls, 1);
  });
});

test('independent stage launch rejects malformed initiate receipts without trying a fallback', async () => {
  await withFetch(async set => {
    const c = context(); const prior = await ticket(c, { phase: 'completed', threadId: 'receipt-shape-thread' });
    const writes: string[] = [];
    set(async (url, init) => {
      const path = apiPath(url);
      if (path === '/api/agent-run/run-test') return Response.json({id:'run-test', status:'completed'});
      if(init?.method === 'POST') writes.push(path);
      assert.equal(path,'/api/agent/initiate');
      return Response.json({ id: 'alternate-id', threadId: prior.threadId, content: key });
    });
    const response = await POST(request({ op: 'start', action: 'plan', context: c, priorTicket: await signSciencePalTicket(prior, key), messageId: crypto.randomUUID() }));
    const text = await response.text(); const returned = JSON.parse(text);
    assert.equal(returned.code, 'initiate_unknown');
    assert.equal(returned.diagnostic.stage, 'initiate');
    assert.equal(returned.diagnostic.upstreamStatus, 200);
    assert.equal(returned.diagnostic.cause, 'invalid_receipt');
    assert.deepEqual(writes, ['/api/agent/initiate']);
    assert.doesNotMatch(text, /test-only-sciencepal-key|alternate-id/);
  });
});

test('new stage and reply require the official prior run to remain completed or asked respectively', async () => {
  await withFetch(async set => {
    const c = context(); const prior = await ticket(c, { phase: 'completed', threadId: 'start-refusal-thread' });
    let writes = 0;
    set(async (url, init) => {
      if(init?.method === 'POST') writes++;
      assert.equal(apiPath(url), '/api/agent-run/run-test');
      return Response.json({ id:'run-test',status:'running' });
    });
    const response = await POST(request({ op: 'start', action: 'plan', context: c, priorTicket: await signSciencePalTicket(prior, key), requestId:crypto.randomUUID() }));
    assert.equal((await body(response)).code,'prior_not_completed');
    const asked = await ticket(c,{phase:'asked',question:'实际问题'});
    assert.equal((await body(await POST(request({op:'reply',ticket:await signSciencePalTicket(asked,key),context:c,message:'回答',messageId:crypto.randomUUID()})))).code,'not_asked');
    assert.equal(writes,0);
  });
});

test('deep research passes the matching confirmed plan and blocks a plan from another input', async () => {
  await withFetch(async set => {
    const c = context(); const fp = await fingerprint(c);
    const plan = { fingerprint: fp, questions: ['核查重复数'], searches: [], tasks: ['仅审查已选论文中的代价函数'], stop: '条件不满足则停止', scope: '静态比较' };
    const confirmation = { approved: true, fingerprint: fp, at: new Date().toISOString() };
    let calls = 0;
    set(async (_, init) => {
      calls++;
      const prompt = new URLSearchParams(String(init?.body)).get('prompt') || '';
      assert.match(prompt, /plan\.tasks/);
      assert.match(prompt, /仅审查已选论文中的代价函数/);
      return Response.json({ thread_id: 'plan-input-thread', agent_run_id: 'plan-input-run' });
    });
    const body = { op: 'start', action: 'deep', context: c, plan, confirmation };
    assert.equal((await POST(request({ ...body, plan: { ...plan, fingerprint: 'f'.repeat(64) } }))).status, 409);
    assert.equal(calls, 0);
    assert.equal((await POST(request(body))).status, 202);
    assert.equal(calls, 1);
  });
});

test('deep result completion uses official run metadata instead of the model-authored timestamp', async () => {
  await withFetch(async set => {
    const c = context(); const t = await ticket(c, { action: 'deep' });
    const artifactData = { ...await deepResearch(c), completedAt: '2026-10-24T00:00:00.000Z' };
    set(async (url, init) => {
      assert.equal(init?.method, undefined);
      const path = apiPath(url);
      if (path === '/api/agent-run/run-test') return Response.json({ id:'run-test', status:'completed', completedAt:'2026-10-24T09:06:36.659+00:00' });
      if (path.endsWith('/sandbox')) return Response.json({thread_id:'thread-test',project_id:'project-test',sandbox_id:'sandbox-test'});
      return Response.json({ schemaVersion:1, requestId:t.requestId, action:'deep', contextFingerprint:t.inputFingerprint, status:'completed', data:artifactData });
    });
    const response = await POST(request({op:'poll',ticket:await signSciencePalTicket(t,key),context:c,confirmation:{approved:true,fingerprint:t.inputFingerprint,at:new Date().toISOString()}}));
    assert.equal(response.status,200);
    const returned = await body(response);
    const data = resultSchema.parse(returned.data); const meta = runMetaSchema.parse(returned.meta);
    assert.equal(data.completedAt,'2026-10-24T09:06:36.659Z');
    assert.equal(data.completedAt,meta.completedAt);
    assert.equal(data.completedAt,meta.upstream?.completedAt);
    assert.equal(artifactData.completedAt,'2026-10-24T00:00:00.000Z');
  });
});
