import { defineConfig } from "tsup";

// VS Code loads extensions as CommonJS. Everything except the `vscode` API is bundled in.
export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node20",
  bundle: true,
  external: ["vscode"],
  noExternal: [/^@burnrate\//],
  sourcemap: true,
  clean: true,
});
