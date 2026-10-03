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
    },
  },
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node",
  },
});
