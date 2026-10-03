import { defineConfig } from "tsup";

// One self-contained file (the only runtime dependency is the optional keychain module): fast cold start matters
// because Claude Code runs `burnrate statusline` after every assistant message.
export default defineConfig({
  entry: { cli: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  noExternal: [/^@burnrate\//],
  // Prebuilt native module, loaded lazily by `burnrate keys` only (never by the status line).
  external: ["@napi-rs/keyring"],
  minify: false,
  sourcemap: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
