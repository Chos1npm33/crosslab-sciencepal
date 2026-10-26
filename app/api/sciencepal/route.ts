import { handleSciencePal, sciencePalConfiguration, sciencePalRequestSchema, SciencePalError } from '@/server/lib/sciencepal';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() { return json(sciencePalConfiguration()); }
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: '请求来源不匹配。' }, 403);
    if (Number(request.headers.get('Content-Length') || 0) > 180000) return json({ error: '研究材料过长。' }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 180000) return json({ error: '研究材料过长。' }, 413);
    let value: unknown; try { value = JSON.parse(raw); } catch { return json({ error: '请求格式错误。' }, 400); }
    const parsed = sciencePalRequestSchema.safeParse(value);
    if (!parsed.success) return json({ error: 'SciencePal 请求信息不完整，请检查阶段、输入与运行凭据。' }, 400);
    const result = await handleSciencePal(parsed.data);
    return json(result.body, result.httpStatus);
  } catch (error) {
    if (error instanceof SciencePalError) return json({ error: error.message, code: error.code, ...error.extra }, error.status);
    return json({ error: 'SciencePal 返回的信息无法按官方接口约定解析，请核对原会话。', code: 'invalid_upstream' }, 502);
  }
}
