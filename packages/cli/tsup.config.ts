import { defineConfig } from "tsup";

// One self-contained file with zero runtime dependencies: fast cold start matters
// because Claude Code runs `burnrate statusline` after every assistant message.
export default defineConfig({
  entry: { cli: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  noExternal: [/^@burnrate\//],
  minify: false,
  sourcemap: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
