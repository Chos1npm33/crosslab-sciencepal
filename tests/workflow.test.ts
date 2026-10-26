import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, GET } from '../app/api/workflow/route';
import { analyze, makePlan, deepResearch, evaluate } from '../lib/demo-provider';
import { initialState, exampleProblem, reviseContext, fingerprint, restoreWorkspace, contextSchema, stateSchema, type Context, type Workspace, type Result, type Analysis, type Plan, type Evaluation, reportMarkdown } from '../lib/research';
import type { UpstreamRun } from '../lib/workflow-provenance';

process.env.RESEARCH_PROVIDER = 'demo';
type ApiResponse<T> = { mode: 'demo' | 'remote'; data: T; meta: { provider: string; inputRevision: number; runId: string; upstream?: UpstreamRun } };
function context(): Context {
  const c = { ...initialState().context, problem: { ...exampleProblem } };
  const a = analyze(c);
  return { ...c, mappings: a.mappings, papers: a.papers };
}
function request(body: unknown, origin = 'http://localhost') {
  return new Request('http://localhost/api/workflow', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
}
async function confirmation(c: Context) { return { approved: true as const, fingerprint: await fingerprint(c), at: new Date().toISOString() }; }
async function completedWorkspace(): Promise<Workspace> {
  const c = context();
  const s = initialState();
  return { ...s, step: 5, context: c, analysis: analyze(c), plan: await makePlan(c), confirmation: await confirmation(c), result: await deepResearch(c), evaluation: evaluate(c) };
}

test('empty drafts survive reload without being treated as complete research', async () => {
  const s = initialState();
  s.context.problem.question = '还在填写';
  const restored = await restoreWorkspace(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.context.problem.question, '还在填写');
  assert.equal(restored.step, 0);
  assert.equal(restored.result, null);
});

test('whole analysis → review → confirmation → research → evaluation contract', async () => {
  let c = { ...initialState().context, problem: { ...exampleProblem } };
  const a = await POST(request({ action: 'analyze', context: c }));
  assert.equal(a.status, 200);
  const analyzed = await a.json() as ApiResponse<Analysis>;
  c = { ...c, papers: analyzed.data.papers, mappings: analyzed.data.mappings };
  const p = await POST(request({ action: 'plan', context: c }));
  assert.equal(p.status, 200);
  const plan = (await p.json() as ApiResponse<Plan>).data;
  const accepted = { approved: true, fingerprint: plan.fingerprint, at: new Date().toISOString() };
  const research = await POST(request({ action: 'deep', context: c, confirmation: accepted }));
  assert.equal(research.status, 200);
  const body = await research.json() as ApiResponse<Result>;
  assert.equal(body.meta.provider, 'demo');
  assert.equal(body.meta.inputRevision, c.revision);
  assert.match(body.meta.runId, /^[0-9a-f-]{36}$/);
  assert.notEqual(body.meta.runId, analyzed.meta.runId);
  const evaluation = await POST(request({ action: 'evaluate', context: c, confirmation: accepted, result: body.data }));
  assert.equal(evaluation.status, 200);
  assert.equal((await evaluation.json() as ApiResponse<Evaluation>).data.decision, '补充条件后继续');
});

test('deep research rejects missing confirmation', async () => {
  assert.equal((await POST(request({ action: 'deep', context: context() }))).status, 409);
});

test('a changed input invalidates confirmation even when revision is forged unchanged', async () => {
  const c = context();
  const accepted = await confirmation(c);
  const changed = { ...c, canCollect: false };
  assert.equal((await POST(request({ action: 'deep', context: changed, confirmation: accepted }))).status, 409);
});

test('evaluate rejects stale results and unknown paper citations', async () => {
  const c = context();
  const accepted = await confirmation(c);
  const r = await deepResearch(c);
  const fake: Result = { ...r, findings: [{ title: '伪引用', body: '无法对应材料', kind: 'evidence', sourceIds: ['UNKNOWN'] }] };
  assert.equal((await POST(request({ action: 'evaluate', context: c, confirmation: accepted, result: fake }))).status, 409);
  assert.equal((await POST(request({ action: 'evaluate', context: c, confirmation: accepted, result: { ...r, fingerprint: '0'.repeat(64) } }))).status, 409);
});

test('upstream edits clear all dependent work and reset reachable stage', async () => {
  const s = await completedWorkspace();
  const revised = reviseContext(s, { note: '增加第三个时期' });
  assert.equal(revised.context.revision, s.context.revision + 1);
  assert.equal(revised.step, 3);
  assert.equal(revised.plan, null);
  assert.equal(revised.confirmation, null);
  assert.equal(revised.result, null);
  assert.equal(revised.evaluation, null);
  const reset = reviseContext(s, { direction: 'custom', method: '新理论' }, true);
  assert.equal(reset.analysis, null);
  assert.deepEqual(reset.context.mappings, []);
  assert.deepEqual(reset.context.papers, []);
});

test('rehydration discards stale results but preserves user research inputs', async () => {
  const s = await completedWorkspace();
  s.context.note = '刷新前修改了计划条件';
  const restored = await restoreWorkspace(s);
  assert.equal(restored.context.note, s.context.note);
  assert.equal(restored.plan, null);
  assert.equal(restored.confirmation, null);
  assert.equal(restored.result, null);
  assert.equal(restored.evaluation, null);
  assert.equal(restored.step, 3);
});

test('restore accepts a coherent completed workspace and rejects corrupted schemas', async () => {
  const s = await completedWorkspace();
  const restored = await restoreWorkspace(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.step, 5);
  assert.ok(restored.result);
  assert.equal(stateSchema.safeParse({ ...s, version: 999 }).success, false);
  assert.equal(stateSchema.safeParse({ ...s, context: { ...s.context, papers: [{ ...s.context.papers[0], url: 'javascript:alert(1)' }] } }).success, false);
});

test('older saved context gains explicit sampling defaults', () => {
  const c = context();
  const { sampleType: _a, goal: _b, canCollect: _d, ...older } = c;
  const parsed = contextSchema.parse(older);
  assert.equal(parsed.sampleType, 'single');
  assert.equal(parsed.goal, 'mechanism');
  assert.equal(parsed.canCollect, true);
});

test('single-timepoint process reconstruction stops when additional sampling is impossible', async () => {
  const c = { ...context(), sampleType: 'single' as const, goal: 'mechanism' as const, canCollect: false };
  const e = evaluate(c);
  assert.equal(e.decision, '暂停当前迁移');
  assert.match(e.reason, /分布比较/);
  const r = await deepResearch(c);
  assert.match(r.hypothesis, /暂停/);
  assert.match(r.experiment.join(''), /分布/);
});

test('single-timepoint distribution/prediction alternative is not blanket-rejected', () => {
  const c = { ...context(), sampleType: 'single' as const, goal: 'prediction' as const, canCollect: false };
  assert.equal(evaluate(c).decision, '补充条件后继续');
});

test('time series alone does not produce a positive scientific conclusion', async () => {
  const c = { ...context(), sampleType: 'timeSeries' as const };
  assert.equal(evaluate(c).decision, '补充条件后继续');
  const r = await deepResearch(c);
  assert.match(r.findings.find(f => f.title === '条件审查')!.body, /生物重复.*生长\/死亡/);
});

test('user-rejected assumptions override favorable resources', () => {
  const c = context();
  c.sampleType = 'timeSeries';
  c.evidence = 'functional';
  c.mappings = c.mappings.map((m, i) => ({ ...m, status: i === 0 ? 'rejected' : 'accepted' }));
  assert.equal(evaluate(c).decision, '暂停当前迁移');
});

test('custom target avoids fixed potato mechanisms and duplicate IDs are rejected', () => {
  const c = { ...context(), problem: { ...exampleProblem, field: '材料物理', question: '如何研究多孔材料中局部应力分布与断裂之间的关系？' } };
  const a = analyze(c);
  assert.doesNotMatch(a.hypothesis, /马铃薯|块茎|微生物/);
  assert.ok(a.mappings.every(m => m.target.includes('材料物理')));
  assert.equal(contextSchema.safeParse({ ...c, papers: [c.papers[0], c.papers[0]] }).success, false);
});

test('transport example includes target-domain background and source-method evidence', () => {
  const a = analyze(context());
  assert.equal(a.papers.length, 2);
  assert.equal(a.papers[0].role, '背景');
  assert.match(a.papers[0].url, /10\.1186\/s12870-024-05758-2/);
  assert.match(a.papers[0].provenance, /公开摘要/);
  assert.match(a.papers[0].boundary, /不直接验证最优传输/);
  assert.equal(a.papers[1].role, '方法');
  assert.match(a.papers[1].url, /10\.1016\/j\.cell\.2019\.01\.006/);
});

test('report exposes actual demo scope and data conditions', async () => {
  const output = reportMarkdown(await completedWorkspace());
  assert.match(output, /# CrossLab/);
  assert.match(output, /预置演示/);
  assert.match(output, /single/);
  assert.match(output, /10\.1016\/j\.cell\.2019\.01\.006/);
});

test('report preserves imported and mixed stage provenance', async () => {
  const s = await completedWorkspace();
  assert.match(reportMarkdown(s, 'imported'), /人工导入：分析结果由用户从外部工作流带回/);
  assert.match(reportMarkdown(s, 'mixed'), /混合运行：不同阶段/);
  assert.match(reportMarkdown(s, 'remote'), /各阶段的服务来源、运行 ID 与输入版本详见运行记录/);
  assert.doesNotMatch(reportMarkdown(s, 'imported'), /## 运行模式\s+预置演示/);
});

test('demo plan labels user abstracts and unexecuted search accurately', async () => {
  const c = context();
  c.papers = [{ ...c.papers[0], role: '用户材料', provenance: '用户提供的摘要；尚未核验' }];
  const p = await makePlan(c);
  assert.match(p.scope, /用户材料仅复述所提供的摘要，未读取其全文/);
  assert.ok(p.searches.every(s => s.startsWith('建议检索（未执行）')));
  assert.match(p.tasks[0], /用户材料/);
  assert.doesNotMatch(p.scope, /已核验|已核对/);
});

test('API rejects cross-origin and malformed/oversized input', async () => {
  assert.equal((await POST(request({ action: 'analyze', context: context() }, 'https://unrelated.test'))).status, 403);
  assert.equal((await POST(new Request('http://localhost/api/workflow', { method: 'POST', body: '{' }))).status, 400);
  assert.equal((await POST(new Request('http://localhost/api/workflow', { method: 'POST', body: '字'.repeat(41000) }))).status, 413);
});

test('remote adapter checks response shape and citations without silently using demo', async () => {
  const originalFetch = globalThis.fetch;
  process.env.RESEARCH_PROVIDER = 'remote';
  process.env.RESEARCH_PROVIDER_URL = 'https://workflow.example.test/run';
  process.env.RESEARCH_PROVIDER_API_KEY = 'test-secret';
  try {
    const c = context();
    const accepted = await confirmation(c);
    let observed: unknown;
    globalThis.fetch = async (_input, init) => {
      observed = JSON.parse(String(init?.body));
      return Response.json({ data: { invalid: true } });
    };
    assert.equal((await POST(request({ action: 'analyze', context: c }))).status, 502);
    assert.equal((observed as { action: string }).action, 'analyze');
    assert.equal((observed as { inputFingerprint: string }).inputFingerprint, await fingerprint(c));
    const result = await deepResearch(c);
    globalThis.fetch = async () => Response.json({ data: { ...result, findings: [{ title: '假引用', body: '引用不存在', kind: 'evidence', sourceIds: ['FAKE'] }] } });
    assert.equal((await POST(request({ action: 'deep', context: c, confirmation: accepted }))).status, 502);
    globalThis.fetch = async () => Response.json({ data: analyze(c) });
    const successful = await POST(request({ action: 'analyze', context: c }));
    assert.equal(successful.status, 200);
    const legacy = await successful.json() as ApiResponse<Analysis>;
    assert.equal(legacy.mode, 'remote');
    assert.equal(legacy.meta.upstream, undefined);
    delete process.env.RESEARCH_PROVIDER_URL;
    assert.equal((await GET()).status, 200);
    assert.equal((await POST(request({ action: 'analyze', context: c }))).status, 503);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.RESEARCH_PROVIDER = 'demo';
    delete process.env.RESEARCH_PROVIDER_URL;
    delete process.env.RESEARCH_PROVIDER_API_KEY;
  }
});

test('remote responses preserve validated upstream provenance separately from the local receipt', async () => {
  const originalFetch = globalThis.fetch;
  const priorProvider = process.env.RESEARCH_PROVIDER;
  const priorUrl = process.env.RESEARCH_PROVIDER_URL;
  process.env.RESEARCH_PROVIDER = 'remote';
  process.env.RESEARCH_PROVIDER_URL = 'https://workflow.example.test/run';
  try {
    const c = context();
    const upstream = { provider: 'Example research platform', runId: 'upstream-run/2026:001', projectUrl: 'https://research.example.test/projects/1', completedAt: '2026-10-24T10:00:00+08:00' };
    globalThis.fetch = async () => Response.json({ data: analyze(c), upstream: { ...upstream, apiKey: 'must-not-reach-browser' }, internal: 'must-not-reach-browser' });
    const response = await POST(request({ action: 'analyze', context: c }));
    assert.equal(response.status, 200);
    const body = await response.json() as ApiResponse<Analysis>;
    assert.equal(body.mode, 'remote');
    assert.equal(body.meta.provider, 'remote');
    assert.notEqual(body.meta.runId, upstream.runId);
    assert.deepEqual(body.meta.upstream, upstream);
    assert.doesNotMatch(JSON.stringify(body), /must-not-reach-browser|apiKey|internal/);
    // The same provenance contract applies to confirmed research results.
    globalThis.fetch = async () => Response.json({ data: await deepResearch(c), upstream });
    const deep = await POST(request({ action: 'deep', context: c, confirmation: await confirmation(c) }));
    assert.equal(deep.status, 200);
    assert.deepEqual((await deep.json() as ApiResponse<Result>).meta.upstream, upstream);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorProvider === undefined) delete process.env.RESEARCH_PROVIDER; else process.env.RESEARCH_PROVIDER = priorProvider;
    if (priorUrl === undefined) delete process.env.RESEARCH_PROVIDER_URL; else process.env.RESEARCH_PROVIDER_URL = priorUrl;
  }
});

test('remote responses reject malformed source records instead of presenting unvalidated attribution', async () => {
  const originalFetch = globalThis.fetch;
  const priorProvider = process.env.RESEARCH_PROVIDER;
  const priorUrl = process.env.RESEARCH_PROVIDER_URL;
  process.env.RESEARCH_PROVIDER = 'remote';
  process.env.RESEARCH_PROVIDER_URL = 'https://workflow.example.test/run';
  try {
    const c = context();
    const source = { provider: 'Research platform', runId: 'task-123', projectUrl: 'https://research.example.test/project/1', completedAt: '2026-10-24T02:00:00Z' };
    const invalid = [
      { ...source, provider: ' ' },
      { ...source, provider: 'x'.repeat(81) },
      { ...source, runId: '' },
      { ...source, runId: 'first\nsecond' },
      { ...source, projectUrl: 'javascript:alert(1)' },
      { ...source, projectUrl: 'not-a-url' },
      { ...source, projectUrl: 'http://research.example.test/project/1' },
      { ...source, projectUrl: 'https://user:secret@research.example.test/project/1' },
      { ...source, completedAt: 'yesterday' },
      { ...source, completedAt: '2026-10-24T02:00:00' },
      { provider: 'Research platform' },
    ];
    for (const upstream of invalid) {
      globalThis.fetch = async () => Response.json({ data: analyze(c), upstream });
      const response = await POST(request({ action: 'analyze', context: c }));
      assert.equal(response.status, 502, JSON.stringify(upstream));
      assert.match(await response.text(), /来源记录不符合接口约定/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (priorProvider === undefined) delete process.env.RESEARCH_PROVIDER; else process.env.RESEARCH_PROVIDER = priorProvider;
    if (priorUrl === undefined) delete process.env.RESEARCH_PROVIDER_URL; else process.env.RESEARCH_PROVIDER_URL = priorUrl;
  }
});
