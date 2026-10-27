import { z } from 'zod';
import { contextSchema, confirmationSchema, resultSchema, fingerprint, hasValidCitations } from '../../../../lib/research';
import * as demo from '../../../../lib/demo-provider';
import { requireReviewContext, ReviewQuotaError } from '../../../../server/lib/review-context';
import { readBoundedText } from '../../../../server/lib/http-body';
export { GET } from '../sciencepal/route';

const schema = z.object({ action: z.enum(['analyze', 'plan', 'deep', 'evaluate']), context: contextSchema, confirmation: confirmationSchema.optional(), result: resultSchema.optional() });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
/** The public demo is always a local simulation, independent of provider secrets. */
export async function POST(request: Request) {
  try {
    requireReviewContext();
    if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: '请求来源不匹配。' }, 403);
    const raw = await readBoundedText(request, 120000);
    if (raw === null) return json({ error: '材料过长或请求中断，请精简后重试。' }, 413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return json({ error: '请求格式错误。' }, 400); }
    const parsed = schema.safeParse(input);
    if (!parsed.success) return json({ error: '研究信息不完整，请检查问题、方向与文献。' }, 400);
    const { action, context, confirmation, result } = parsed.data;
    const current = await fingerprint(context);
    if (action !== 'analyze' && (!context.mappings.length || !context.papers.length)) return json({ error: '请先完成文献分析，并保留至少一篇文献。' }, 400);
    if (['deep', 'evaluate'].includes(action) && (!confirmation?.approved || confirmation.fingerprint !== current)) return json({ error: '研究条件已变化，请重新确认深研计划。' }, 409);
    if (action === 'evaluate' && (!result || result.fingerprint !== current || !hasValidCitations(result, context.papers))) return json({ error: '请先完成当前版本的深研，并检查文献引用。' }, 409);
    const startedAt = new Date().toISOString();
    const data = action === 'analyze' ? demo.analyze(context) : action === 'plan' ? await demo.makePlan(context) : action === 'deep' ? await demo.deepResearch(context) : demo.evaluate(context);
    return json({ mode: 'demo', data, meta: { runId: crypto.randomUUID(), inputRevision: context.revision, inputFingerprint: current, provider: 'demo', status: 'completed', startedAt, completedAt: new Date().toISOString() } });
  } catch (error) {
    return error instanceof ReviewQuotaError ? json({ error: error.message, code: error.code, ...error.extra }, error.status) : json({ error: '演示请求未完成，请稍后重试。' }, 502);
  }
}

