import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

export type ReviewContext = { role: 'owner' | 'review'; visitorId: string; budget?: Pick<Fetcher, 'fetch'> };
const contexts = new AsyncLocalStorage<ReviewContext | undefined>();
export const runWithReviewContext = <T>(context: ReviewContext | undefined, run: () => T): T => contexts.run(context, run);
export const getReviewContext = () => contexts.getStore();
export const quotaSchema = z.object({ totalLimit: z.literal(30), totalUsed: z.number().int().min(0).max(30), totalRemaining: z.number().int().min(0).max(30), visitorLimit: z.number().int().min(8).max(30), visitorUsed: z.number().int().min(0).max(30), visitorRemaining: z.number().int().min(0).max(30), retryAfterSeconds: z.number().int().min(0).max(60).optional() });
export type ReviewQuota = z.infer<typeof quotaSchema>;
export class ReviewQuotaError extends Error {
  constructor(message: string, public status = 503, public code = 'quota_unavailable', public extra: Record<string, unknown> = { mutationStarted: false }) { super(message); }
}
export function requireReviewContext() {
  const context = getReviewContext();
  if (!context || context.role !== 'review') throw new ReviewQuotaError('请重新打开评审入口后继续。', 401, 'review_session_required');
  return context;
}
export function researchContext() {
  const context = getReviewContext();
  if (!context && process.env.CROSSLAB_REVIEW_ENABLED === 'true') throw new ReviewQuotaError('研究额度服务暂不可用，请稍后重试。');
  return context;
}
async function call(path: string, data: Record<string, unknown> = {}) {
  const context = researchContext();
  if (!context?.budget) throw new ReviewQuotaError('研究额度服务暂不可用，请稍后重试。');
  let response: Response;
  let value: unknown;
  try {
    response = await context.budget.fetch('https://research-quota.internal/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: context.role, visitorId: context.visitorId, ...data }) });
    value = await response.json();
  } catch { throw new ReviewQuotaError('研究额度服务暂不可用，请稍后重试。'); }
  if (!response.ok) {
    const parsed = z.object({ error: z.string(), code: z.string(), quota: quotaSchema.optional(), status: z.literal('unknown').optional(), requestId: z.string().uuid().optional() }).safeParse(value);
    if (!parsed.success) throw new ReviewQuotaError('研究额度服务暂不可用，请稍后重试。');
    throw new ReviewQuotaError(parsed.data.error, response.status, parsed.data.code, { ...parsed.data, mutationStarted: parsed.data.status === 'unknown' ? undefined : false });
  }
  return value;
}
export async function reviewQuota() {
  try { return quotaSchema.parse((await call('status') as { quota: unknown }).quota); }
  catch (error) { if (error instanceof ReviewQuotaError) throw error; throw new ReviewQuotaError('研究额度服务返回异常，请稍后重试。'); }
}
const storedResponse = z.object({ httpStatus: z.number().int().min(200).max(599), body: z.record(z.unknown()) });
export async function reserveResearch(requestId: string, signature: string) {
  const response = z.union([
    z.object({ kind: z.literal('dispatch'), claim: z.string().uuid(), quota: quotaSchema }),
    z.object({ kind: z.literal('replay'), response: storedResponse, quota: quotaSchema }),
  ]).safeParse(await call('reserve', { requestId, signature }));
  if (!response.success) throw new ReviewQuotaError('研究额度服务返回异常，本次不会启动新任务。');
  return response.data;
}
export async function completeResearch(requestId: string, claim: string, response: z.infer<typeof storedResponse>) {
  // Once dispatched, a failed receipt write must never make the launch retryable.
  // The durable reservation remains occupied; the caller still gets its real ticket.
  try { await call('complete', { requestId, claim, response }); } catch { /* unknown reservations are never automatically dispatched again */ }
}

