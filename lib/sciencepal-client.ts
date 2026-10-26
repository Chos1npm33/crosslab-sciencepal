import { z } from 'zod';
import { analysisSchema, planSchema, resultSchema, evaluationSchema, stateSchema, runMetaSchema, fingerprint, hasValidCitations, type Workspace } from './research';

export const workflowActionSchema = z.enum(['analyze', 'plan', 'deep', 'evaluate']);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ticket = z.string().min(1).max(100000);
const safeUrl = z.string().url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; });
export const clarificationSchema = z.object({ messageId: z.string().uuid(), question: z.string().max(30000), answer: z.string().min(1).max(6000), submittedAt: z.string().datetime(), accepted: z.boolean().default(false) });
export const sciencepalProgressSchema = z.object({
  mode: z.literal('sciencepal'), status: z.enum(['running', 'asked']), ticket,
  action: workflowActionSchema, runId: z.string().min(1).nullable(), threadId: z.string().min(1), inputFingerprint: hash,
  retryAfterMs: z.number().int().min(1000).max(60000).default(5000), question: z.string().max(30000).optional(), projectUrl: safeUrl.optional(),
});
export const sciencepalCompletedSchema = z.object({ mode: z.literal('sciencepal'), status: z.literal('completed'), ticket, action: workflowActionSchema, data: z.unknown(), meta: runMetaSchema });
export const sciencepalPendingSchema = z.object({
  ticket: ticket.nullable(), action: workflowActionSchema, workspace: stateSchema, inputFingerprint: hash,
  runId: z.string().min(1).nullable(), threadId: z.string().min(1), status: z.enum(['running', 'asked', 'failed', 'unknown']),
  question: z.string().max(30000).optional(), projectUrl: safeUrl.optional(), error: z.string().max(3000).optional(),
  retryAfterMs: z.number().int().min(1000).max(60000).default(5000),
  reply: z.object({ messageId: z.string().uuid(), message: z.string().min(1).max(6000) }).optional(),
  clarifications: z.array(clarificationSchema).max(50).default([]),
});
export type SciencePalPending = z.infer<typeof sciencepalPendingSchema>;
export const sciencepalSessionSchema = z.object({ priorTicket: ticket.nullable().default(null), pending: sciencepalPendingSchema.nullable().default(null) });
export const sciencepalFailureSchema = z.object({ error: z.string().optional(), code: z.string().optional(), ticket: ticket.optional(), runId: z.string().min(1).nullable().optional(), threadId: z.string().min(1).optional(), status: z.enum(['failed', 'unknown']).optional(), mutationStarted: z.boolean().optional() });

export function sciencePalWorkflowBody(workspace: Workspace, clarifications: { question: string; answer: string }[] = []) {
  return { context: workspace.context, ...(workspace.plan ? { plan: workspace.plan } : {}), ...(workspace.confirmation ? { confirmation: workspace.confirmation } : {}), ...(workspace.result ? { result: workspace.result } : {}), ...(clarifications.length ? { clarifications: clarifications.slice(-50).map(({ question, answer }) => ({ question, answer })) } : {}) };
}

/** Only explicit pre-mutation failures permit a new start. Existing asked runs remain resumable. */
export function handleSciencePalFailure(raw: unknown, current: SciencePalPending | null, op: 'start' | 'poll' | 'reply') {
  const failure = sciencepalFailureSchema.parse(raw);
  if (!current) return { failure, pending: null };
  const safeToRetry = failure.mutationStarted === false && failure.status !== 'unknown';
  if (safeToRetry && op === 'start') return { failure, pending: null };
  if (op === 'reply' && !safeToRetry && (failure.code === 'initiate_unknown' || (failure.status === 'unknown' && failure.ticket && failure.ticket !== current.ticket))) {
    const pending: SciencePalPending = { ...current, ticket: failure.ticket || null, runId: failure.runId || null, threadId: failure.threadId || 'pending', projectUrl: undefined, status: 'unknown', error: failure.error || '新任务的启动结果尚不确定，请到 SciencePal 核对。' };
    return { failure, pending };
  }
  const pending: SciencePalPending = { ...current, ...(failure.ticket ? { ticket: failure.ticket } : {}), status: safeToRetry && op === 'reply' ? 'asked' : failure.status || 'failed', error: failure.error || 'SciencePal 请求未完成。' };
  return { failure, pending };
}

/** Validate before merging, including after a browser refresh or a paused wait. */
export async function completeSciencePalTask(raw: unknown, pending: SciencePalPending, current: Workspace) {
  const completed = sciencepalCompletedSchema.parse(raw);
  if (completed.meta.provider !== 'sciencepal' || !completed.meta.upstream || (pending.runId && completed.meta.runId !== pending.runId)) throw new Error('SciencePal 运行来源或任务编号不匹配，结果尚未合并。');
  const inputHash = await fingerprint(pending.workspace.context);
  if (completed.action !== pending.action || inputHash !== pending.inputFingerprint || completed.meta.inputFingerprint !== inputHash || completed.meta.inputRevision !== pending.workspace.context.revision) throw new Error('SciencePal 返回的任务或输入版本不匹配，结果尚未合并。');
  if (await fingerprint(current.context) !== inputHash) throw new Error('研究条件已经修改。旧任务结果保留在 SciencePal，当前方案需要重新运行。');
  const schemas = { analyze: analysisSchema, plan: planSchema, deep: resultSchema, evaluate: evaluationSchema };
  const data = schemas[completed.action].parse(completed.data);
  let next = { ...pending.workspace };
  if (completed.action === 'analyze') {
    const analysis = analysisSchema.parse(data);
    next = { ...next, step: 2, analysis, context: { ...next.context, papers: analysis.papers, mappings: analysis.mappings }, plan: null, confirmation: null, result: null, evaluation: null };
  } else if (completed.action === 'plan') {
    const plan = planSchema.parse(data);
    if (plan.fingerprint !== inputHash) throw new Error('SciencePal 返回的研究计划版本不匹配。');
    next = { ...next, step: 4, plan, confirmation: null, result: null, evaluation: null };
  } else if (completed.action === 'deep') {
    const result = resultSchema.parse(data);
    if (next.confirmation?.fingerprint !== inputHash || result.fingerprint !== inputHash || !hasValidCitations(result, next.context.papers)) throw new Error('深研结果的确认版本或引用标识不匹配。');
    next = { ...next, step: 4, result, evaluation: null };
  } else {
    if (next.confirmation?.fingerprint !== inputHash || next.result?.fingerprint !== inputHash) throw new Error('当前版本尚未完成确认与深研。');
    next = { ...next, step: 5, evaluation: evaluationSchema.parse(data) };
  }
  return { completed, next, data };
}
