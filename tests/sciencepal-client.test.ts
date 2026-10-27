import test from 'node:test';
import assert from 'node:assert/strict';
import { sciencepalProgressSchema, sciencepalSessionSchema, completeSciencePalTask, handleSciencePalFailure, sciencePalWorkflowBody, type SciencePalPending, type WorkflowAction } from '../lib/sciencepal-client';
import { initialState, exampleProblem, fingerprint, analysisSchema, type Workspace } from '../lib/research';
import { analyze, makePlan, deepResearch } from '../lib/demo-provider';

const now = '2026-10-24T06:00:00.000Z';
async function setup(action: WorkflowAction = 'analyze') {
  const state = initialState(); state.context.problem = { ...exampleProblem };
  if (action !== 'analyze') {
    state.analysis = analyze(state.context);
    state.context.papers = state.analysis.papers;
    state.context.mappings = state.analysis.mappings;
    state.plan = await makePlan(state.context);
    state.confirmation = { approved: true, at: now, fingerprint: state.plan.fingerprint };
  }
  const fp = await fingerprint(state.context);
  const pending: SciencePalPending = { ticket: 'opaque-ticket', action, workspace: structuredClone(state), inputFingerprint: fp, runId: 'official-run', threadId: 'official-thread', status: 'running', retryAfterMs: 5000, clarifications: [] };
  const meta = { runId: pending.runId, inputRevision: state.context.revision, inputFingerprint: fp, provider: 'sciencepal', status: 'completed', startedAt: now, completedAt: now, upstream: { provider: 'SciencePal', runId: pending.runId, projectUrl: 'https://sciencepal.ai/projects/project/thread/thread', completedAt: now } };
  return { state, pending, response: { mode: 'sciencepal', status: 'completed', action, ticket: 'completed-ticket', meta, data: action === 'analyze' ? analyze(state.context) : action === 'plan' ? state.plan : await deepResearch(state.context) } };
}

test('unknown start and nullable run ID survive a browser session restore', async () => {
  const { pending } = await setup();
  const restored = sciencepalSessionSchema.parse(JSON.parse(JSON.stringify({ priorTicket: null, pending: { ...pending, ticket: null, runId: null, status: 'unknown' } })));
  assert.equal(restored.pending?.status, 'unknown');
  assert.equal(restored.pending?.ticket, null);
  assert.equal(restored.pending?.runId, null);
});

test('asked progress keeps the actual question and accepts unresolved run identity', async () => {
  const { pending } = await setup();
  const progress = sciencepalProgressSchema.parse({ ...pending, mode: 'sciencepal', status: 'asked', runId: null, question: '样本来自单个时期还是多个时期？' });
  assert.equal(progress.question, '样本来自单个时期还是多个时期？');
  assert.equal(progress.runId, null);
});

test('a completed analysis preserves official provenance and merges only the validated product', async () => {
  const { state, pending, response } = await setup();
  const output = await completeSciencePalTask(response, pending, state);
  assert.equal(output.next.step, 2);
  assert.equal(output.next.analysis?.hypothesis, analyze(state.context).hypothesis);
  assert.equal(output.completed.meta.upstream?.provider, 'SciencePal');
  assert.equal(output.completed.meta.runId, 'official-run');
  assert.equal(output.next.context.papers.length, 2);
});

test('six valid analysis questions are preserved without accepting unsolicited later stages', async () => {
  const { state, pending, response } = await setup();
  const questions = Array.from({ length: 6 }, (_, index) => `需要研究者确认的条件 ${index + 1} 是什么？`);
  const data = { ...analyze(state.context), questions, plan: { tasks: ['尚未确认的计划'] }, deep: { hypothesis: '尚未执行的深研' } };
  const output = await completeSciencePalTask({ ...response, data }, pending, state);
  assert.deepEqual(output.next.analysis?.questions, questions);
  assert.equal(output.next.step, 2);
  assert.equal(output.next.plan, null);
  assert.equal(output.next.confirmation, null);
  assert.equal(output.next.result, null);
  assert.equal(output.next.evaluation, null);
  assert.equal(Object.hasOwn(output.data, 'plan'), false);
  assert.equal(Object.hasOwn(output.data, 'deep'), false);
});

test('analysis questions retain count, type and per-item text limits', () => {
  const state = initialState(); state.context.problem = { ...exampleProblem };
  const data = analyze(state.context);
  const ten = Array.from({ length: 10 }, (_, index) => `待确认条件 ${index + 1}`);
  assert.deepEqual(analysisSchema.parse({ ...data, questions: ten }).questions, ten);
  assert.equal(analysisSchema.safeParse({ ...data, questions: [...ten, '第十一个问题'] }).success, false);
  assert.equal(analysisSchema.safeParse({ ...data, questions: ['问'.repeat(6000)] }).success, true);
  for (const item of [null, 1, {}, '', '   ', '问'.repeat(6001)]) {
    assert.equal(analysisSchema.safeParse({ ...data, questions: ['有效问题', item] }).success, false);
  }
});

test('changed input or forged run metadata never merges into current research', async () => {
  const { state, pending, response } = await setup();
  const edited: Workspace = structuredClone(state); edited.context.note = '现在无法补充采样';
  await assert.rejects(completeSciencePalTask(response, pending, edited), /输入已修改|条件已经修改/);
  await assert.rejects(completeSciencePalTask({ ...response, meta: { ...response.meta, provider: 'demo' } }, pending, state), /来源或任务编号/);
  await assert.rejects(completeSciencePalTask({ ...response, meta: { ...response.meta, runId: 'different-run' } }, pending, state), /来源或任务编号/);
  await assert.rejects(completeSciencePalTask({ ...response, meta: { ...response.meta, inputRevision: 999 } }, pending, state), /输入版本/);
});

test('deep completion requires confirmation and citations from the selected papers', async () => {
  const { state, pending, response } = await setup('deep');
  const good = await completeSciencePalTask(response, pending, state);
  assert.ok(good.next.result);
  await assert.rejects(completeSciencePalTask(response, { ...pending, workspace: { ...pending.workspace, confirmation: null } }, state), /确认版本或引用/);
  const invalid = await deepResearch(state.context); invalid.findings[0].sourceIds = ['UNKNOWN'];
  await assert.rejects(completeSciencePalTask({ ...response, data: invalid }, pending, state), /确认版本或引用/);
});

test('clarifications and stable reply IDs survive interrupted answers', async () => {
  const { pending } = await setup();
  const messageId = '12345678-1234-4123-8123-123456789abc';
  const session = sciencepalSessionSchema.parse({ priorTicket: 'previous-completed', pending: { ...pending, status: 'asked', reply: { messageId, message: '只有单次采样' }, clarifications: [{ messageId, question: '是否有多个时期？', answer: '只有单次采样', submittedAt: now, accepted: false }] } });
  assert.equal(session.pending?.reply?.messageId, messageId);
  assert.equal(session.pending?.clarifications[0].answer, '只有单次采样');
  assert.equal(session.pending?.clarifications[0].accepted, false);
});

test('only explicit preflight failure clears a new-stage pending record', async () => {
  const { pending } = await setup();
  const failure = { error: '预检失败，消息尚未发送', code: 'preflight_failed', mutationStarted: false };
  assert.equal(handleSciencePalFailure(failure, pending, 'start').pending, null);
  assert.equal(handleSciencePalFailure({ error: '请求失败' }, pending, 'start').pending?.ticket, pending.ticket);
  assert.equal(handleSciencePalFailure({ ...failure, mutationStarted: true }, pending, 'start').pending?.ticket, pending.ticket);
  const unknown = handleSciencePalFailure({ ...failure, status: 'unknown', ticket: 'recoverable-ticket' }, pending, 'start');
  assert.equal(unknown.pending?.ticket, 'recoverable-ticket');
  assert.equal(unknown.pending?.status, 'unknown');
});

test('reply preflight failure keeps the asked task and stable reply for retry', async () => {
  const { pending } = await setup();
  const reply = { messageId: '12345678-1234-4123-8123-123456789abc', message: '只有单次采样' };
  const output = handleSciencePalFailure({ error: '预检失败', code: 'preflight_failed', mutationStarted: false }, { ...pending, status: 'asked', reply, question: '是否有多个时期？' }, 'reply');
  assert.equal(output.pending?.status, 'asked');
  assert.equal(output.pending?.ticket, pending.ticket);
  assert.equal(output.pending?.reply?.messageId, reply.messageId);
  assert.equal(output.pending?.question, '是否有多个时期？');
});

test('an unknown independent reply launch never reuses the old asked task for polling', async () => {
  const { pending } = await setup();
  const messageId = '12345678-1234-4123-8123-123456789abc';
  const current: SciencePalPending = { ...pending, status: 'asked', projectUrl: 'https://sciencepal.ai/projects/old-project/thread/old-thread', question: '能否补充采样？', reply: { messageId, message: '可以补充' }, clarifications: [{ messageId, question: '能否补充采样？', answer: '可以补充', submittedAt: now, accepted: false }] };
  const output = handleSciencePalFailure({ code: 'initiate_unknown', status: 'unknown', error: '请到平台核对新任务' }, current, 'reply');
  assert.equal(output.pending?.ticket, null);
  assert.equal(output.pending?.runId, null);
  assert.equal(output.pending?.threadId, 'pending');
  assert.equal(output.pending?.projectUrl, undefined);
  assert.equal(output.pending?.status, 'unknown');
  assert.equal(output.pending?.reply?.messageId, messageId);
  assert.equal(output.pending?.clarifications[0].answer, '可以补充');
});

test('an unknown reply with a new recovery ticket retains only the new task identity', async () => {
  const { pending } = await setup();
  const output = handleSciencePalFailure({ code: 'start_unknown', status: 'unknown', ticket: 'new-recovery-ticket', threadId: 'new-thread' }, { ...pending, status: 'asked', projectUrl: 'https://sciencepal.ai/projects/old/thread/old' }, 'reply');
  assert.equal(output.pending?.ticket, 'new-recovery-ticket');
  assert.equal(output.pending?.threadId, 'new-thread');
  assert.equal(output.pending?.runId, null);
  assert.equal(output.pending?.projectUrl, undefined);
});

test('deep workflow body sends the exact confirmed plan and omits absent plan', async () => {
  const { state } = await setup('deep');
  const body = sciencePalWorkflowBody(state);
  assert.deepEqual(body.plan, state.plan);
  assert.equal(body.plan?.fingerprint, body.confirmation?.fingerprint);
  assert.equal(Object.hasOwn(sciencePalWorkflowBody(initialState()), 'plan'), false);
});

test('independent stage tasks receive the supplied clarification history without altering context', async () => {
  const { state } = await setup('deep');
  const clarifications = [{ question: '是否有多个时期？', answer: '只有单次采样' }, { question: '能否补充实验？', answer: '可以安排' }];
  const body = sciencePalWorkflowBody(state, clarifications);
  assert.deepEqual(body.clarifications, clarifications);
  assert.deepEqual(body.context, state.context);
  assert.equal(Object.hasOwn(sciencePalWorkflowBody(state), 'clarifications'), false);
});

