import { POST as nativePost } from '../../sciencepal/route';
import { sciencePalConfiguration } from '../../../../server/lib/sciencepal';
import { requireReviewContext, reviewQuota, ReviewQuotaError } from '../../../../server/lib/review-context';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(error: unknown) {
  return error instanceof ReviewQuotaError
    ? json({ error: error.message, code: error.code, ...error.extra }, error.status)
    : json({ error: '评审服务暂不可用，请稍后重试。', code: 'review_unavailable' }, 503);
}
export async function GET() {
  try { requireReviewContext(); return json({ ...sciencePalConfiguration(), quota: await reviewQuota() }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireReviewContext();
    if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: '请求来源不匹配。', code: 'invalid_origin', mutationStarted: false }, 403);
    const response = await nativePost(request);
    const body = await response.json() as Record<string, unknown>;
    try { body.quota = await reviewQuota(); } catch { /* Preserve an existing task receipt when only the status read fails. */ }
    return json(body, response.status);
  } catch (error) { return failure(error); }
}

