// Copies the built dashboard UI into dist/dashboard so `burnrate dashboard` ships in one package.
import { cpSync, existsSync, rmSync } from "node:fs";

const from = new URL("../../../apps/dashboard/dist/", import.meta.url);
const to = new URL("../dist/dashboard/", import.meta.url);
if (!existsSync(new URL("index.html", from))) {
  console.warn(
    "copy-dashboard: apps/dashboard/dist not found; `burnrate dashboard` will serve the API only.",
  );
  process.exit(0);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("copy-dashboard: copied UI into dist/dashboard");
