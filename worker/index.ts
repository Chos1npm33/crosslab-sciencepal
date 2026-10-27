import handler from "vinext/server/fetch-handler";
import { withWebsiteAccess } from "./access";
import { runWithReviewContext } from "../server/lib/review-context";
export { LoginAttemptCounter } from "./access-rate-limit";
export { ResearchQuota } from "./research-quota";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    return withWebsiteAccess(request, env, async grant => runWithReviewContext(
      env.CROSSLAB_REVIEW_ENABLED === 'true' && grant ? { ...grant, budget: env.CROSSLAB_RESEARCH_QUOTA?.get(env.CROSSLAB_RESEARCH_QUOTA.idFromName('sciencepal-budget-v1')) } : undefined,
      async () => {
      // Standalone assets must pass the same gate as pages and APIs. The binding
      // serves a matching asset directly; framework routes continue through Vinext.
      if (env.CROSSLAB_AUTH_REQUIRED === 'true' && env.ASSETS && ['GET', 'HEAD'].includes(request.method) && !new URL(request.url).pathname.startsWith('/api/')) {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
      }
      return handler.fetch(request, env, ctx);
    }));
  },
};

export default worker;

