import vinext from "vinext";
import { defineConfig } from "vite";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";

export default defineConfig(async () => {
  configureToolEnvironment(process.cwd());
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    plugins: [
      vinext(),
      cloudflare({
        configPath: "wrangler.json",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
      }),
    ],
  };
});
