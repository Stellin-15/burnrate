import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the CLI can serve the build from any port.
  base: "./",
  resolve: {
    // Build straight from workspace sources so the dashboard never waits on other packages' dist.
    alias: {
      "@burnrate/core/browser": src("../../packages/core/src/browser.ts"),
      "@burnrate/pricing": src("../../packages/pricing/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    // `burnrate dashboard --no-open --port 4777` provides the API during `pnpm dev`.
    proxy: { "/api": { target: "http://127.0.0.1:4777", changeOrigin: true } },
  },
});
