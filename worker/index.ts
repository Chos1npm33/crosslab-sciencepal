import handler from "vinext/server/fetch-handler";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
      return handler.fetch(request, env, ctx);
  },
};

export default worker;
