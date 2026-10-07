import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        // The pool's bundled workerd lags wrangler's; raise this when @cloudflare/vitest-pool-workers catches up.
        compatibilityDate: "2026-08-22",
        bindings: { TURNSTILE_SECRET: "test-turnstile", PASS_SECRET: "test-pass-secret", MAIL_TO: "inbox@example.com" },
      },
    }),
  ],
  test: { include: ["worker/**/*.test.ts"] },
});
