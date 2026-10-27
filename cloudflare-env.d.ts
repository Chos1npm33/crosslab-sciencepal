declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ASSETS?: Fetcher;
    CROSSLAB_AUTH_REQUIRED?: string;
    CROSSLAB_ACCESS_CODE?: string;
    CROSSLAB_LOGIN_GUARD?: DurableObjectNamespace;
    CROSSLAB_REVIEW_ENABLED?: string;
    CROSSLAB_RESEARCH_QUOTA?: DurableObjectNamespace;
  }
}

