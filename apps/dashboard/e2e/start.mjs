// Seeds an isolated fake home and starts the built CLI's dashboard for end-to-end tests.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "burnrate-e2e-"));
execFileSync(process.execPath, [join(here, "seed.mjs"), join(home, ".claude")], { stdio: "inherit" });
mkdirSync(join(home, ".burnrate"));
writeFileSync(
  join(home, ".burnrate", "config.json"),
  JSON.stringify({ budgets: { monthly: 400, daily: 25 } }),
);

const cli = join(here, "..", "..", "..", "packages", "cli", "dist", "cli.js");
const child = spawn(
  process.execPath,
  [cli, "dashboard", "--no-open", "--port", process.env.E2E_PORT ?? "4799"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: "",
      XDG_CONFIG_HOME: join(home, ".config"),
      BURNRATE_DASHBOARD_TOKEN: "e2e-token",
    },
  },
);
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
