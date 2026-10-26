import { z } from 'zod';
import { contextSchema, analysisSchema, planSchema, resultSchema, evaluationSchema, confirmationSchema, fingerprint, hasValidCitations } from '@/lib/research';
import * as demo from '@/lib/demo-provider';
import { remoteWorkflowEnvelopeSchema, type UpstreamRun } from '@/lib/workflow-provenance';
import { sciencePalConfiguration } from '@/server/lib/sciencepal';

const requestSchema = z.object({ action: z.enum(['analyze', 'plan', 'deep', 'evaluate']), context: contextSchema, confirmation: confirmationSchema.optional(), result: resultSchema.optional() });
const schemas = { analyze: analysisSchema, plan: planSchema, deep: resultSchema, evaluate: evaluationSchema };
function mode() { return process.env.RESEARCH_PROVIDER === 'sciencepal' ? 'sciencepal' : process.env.RESEARCH_PROVIDER === 'remote' ? 'remote' : 'demo'; }
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }
export async function GET() { return mode() === 'sciencepal' ? json(sciencePalConfiguration()) : json({ mode: mode(), ready: mode() === 'demo' || !!process.env.RESEARCH_PROVIDER_URL }); }
export async function POST(request: Request) {
  if (mode() === 'sciencepal') return json({ error: 'SciencePal 使用异步运行，请通过 /api/sciencepal 启动或查询已有任务。', code: 'async_endpoint_required' }, 409);
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: '请求来源不匹配。' }, 403);
    if (Number(request.headers.get('Content-Length') || 0) > 120000) return json({ error: '材料过长，请精简后重试。' }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 120000) return json({ error: '材料过长，请精简后重试。' }, 413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return json({ error: '请求格式错误。' }, 400); }
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return json({ error: '研究信息不完整，请检查问题、方向与文献。' }, 400);
    const { action, context, confirmation, result } = parsed.data;
    const current = await fingerprint(context);
    if (['plan', 'deep', 'evaluate'].includes(action) && (!context.mappings.length || !context.papers.length)) return json({ error: '请先完成文献分析，并保留至少一篇文献。' }, 400);
    if (['deep', 'evaluate'].includes(action) && (!confirmation?.approved || confirmation.fingerprint !== current)) return json({ error: '研究条件已变化，请重新确认深研计划。' }, 409);
    if (action === 'evaluate' && (!result || result.fingerprint !== current || !hasValidCitations(result, context.papers))) return json({ error: '请先完成当前版本的深研，并检查文献引用。' }, 409);
    let data: unknown;
    let upstream: UpstreamRun | undefined;
    if (mode() === 'remote') {
      const endpoint = process.env.RESEARCH_PROVIDER_URL;
      if (!endpoint) return json({ error: '研究服务尚未配置。请设置服务端 RESEARCH_PROVIDER_URL。' }, 503);
      const url = new URL(endpoint);
      if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return json({ error: '研究服务 URL 配置不符合要求。' }, 503);
      const response = await fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(process.env.RESEARCH_PROVIDER_API_KEY ? { Authorization: `Bearer ${process.env.RESEARCH_PROVIDER_API_KEY}` } : {}) }, body: JSON.stringify({ schemaVersion: 1, runId, inputFingerprint: current, action, context, confirmation, result }), signal: AbortSignal.timeout(60000) });
      if (response.status >= 300 && response.status < 400) return json({ error: '研究服务返回了重定向，请直接配置目标服务地址。' }, 502);
      if (!response.ok) return json({ error: `研究服务暂时不可用（${response.status}），可重试。` }, 502);
      const external = remoteWorkflowEnvelopeSchema.safeParse(await response.json());
      if (!external.success) return json({ error: '研究服务返回的来源记录不符合接口约定，请检查提供方、运行编号、项目链接和完成时间。' }, 502);
      data = external.data.data;
      upstream = external.data.upstream;
    } else {
      data = action === 'analyze' ? demo.analyze(context) : action === 'plan' ? await demo.makePlan(context) : action === 'deep' ? await demo.deepResearch(context) : demo.evaluate(context);
    }
    const checked = schemas[action].safeParse(data);
    if (!checked.success) return json({ error: '研究服务返回的结构不符合接口约定，请检查适配器。' }, 502);
    if ((action === 'plan' || action === 'deep') && (checked.data as { fingerprint: string }).fingerprint !== current) return json({ error: '服务返回了过期版本，请重试。' }, 502);
    if (action === 'deep' && !hasValidCitations(checked.data as z.infer<typeof resultSchema>, context.papers)) return json({ error: '研究服务返回了无法对应已选文献的引用，请检查适配器。' }, 502);
    return json({ mode: mode(), data: checked.data, meta: { runId, inputRevision: context.revision, inputFingerprint: current, provider: mode(), status: 'completed', startedAt, completedAt: new Date().toISOString(), ...(upstream ? { upstream } : {}) } });
  } catch (error) {
    return json({ error: error instanceof Error && error.name === 'TimeoutError' ? '研究服务响应超时，请重试。' : '研究请求未完成，请稍后重试。' }, 502);
  }
}
