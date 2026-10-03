import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Tests run against TypeScript sources directly, so no build is needed first.
export default defineConfig({
  resolve: {
    alias: {
      "@burnrate/core": src("./packages/core/src/index.ts"),
      "@burnrate/pricing": src("./packages/pricing/src/index.ts"),
      "@burnrate/adapter-claude-code": src("./packages/adapters/claude-code/src/index.ts"),
      "@burnrate/store": src("./packages/store/src/index.ts"),
      "@burnrate/adapter-anthropic-api": src("./packages/adapters/anthropic-api/src/index.ts"),
      "@burnrate/adapter-openai-api": src("./packages/adapters/openai-api/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/vscode/src/**/*.test.ts"],
    environment: "node",
  },
});
