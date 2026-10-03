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

// Synthetic provider spend (as if `burnrate sync` had run) and a status line snapshot with plan limits.
const { BurnrateStore } = await import(
  new URL("../../../packages/store/dist/index.js", import.meta.url).href
);
const store = new BurnrateStore(join(home, ".burnrate", "burnrate.db"));
const M = 1_000_000;
for (let i = 9; i >= 0; i--) {
  const start = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - i),
  );
  const end = new Date(start.getTime() + 86_400_000);
  const bucket = { bucketStart: start.toISOString(), bucketEnd: end.toISOString(), scope: "" };
  store.upsertProviderUsage([
    {
      provider: "anthropic",
      ...bucket,
      model: "claude-opus-5-5",
      uncachedInputTokens: M,
      cacheReadTokens: 10 * M,
      cacheWriteTokens: 0,
      cacheWriteLongTokens: M,
      outputTokens: M,
    },
    {
      provider: "openai",
      ...bucket,
      model: "gpt-5",
      uncachedInputTokens: M,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWriteLongTokens: 0,
      outputTokens: M,
      requests: 40,
    },
  ]);
  store.replaceProviderCosts("anthropic", bucket.bucketStart, bucket.bucketEnd, [
    {
      provider: "anthropic",
      ...bucket,
      item: "Claude Opus 5.5 tokens",
      model: "claude-opus-5-5",
      amountUsd: 32,
    },
  ]);
  store.replaceProviderCosts("openai", bucket.bucketStart, bucket.bucketEnd, [
    { provider: "openai", ...bucket, item: "gpt-5, output", model: "gpt-5", amountUsd: 11.25 },
  ]);
}
store.setSyncState("anthropic", Date.now());
store.setSyncState("openai", Date.now());
store.close();
mkdirSync(join(home, ".burnrate", "state"));
const inHours = (h) => Math.floor(Date.now() / 1000) + h * 3600;
writeFileSync(
  join(home, ".burnrate", "state", "last-status.json"),
  JSON.stringify({
    version: 1,
    updatedAt: Date.now(),
    rateLimitsAt: Date.now(),
    rateLimits: {
      five_hour: { used_percentage: 39, resets_at: inHours(2) },
      seven_day: { used_percentage: 37, resets_at: inHours(100) },
    },
    recentSessions: [],
  }),
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
      // Never touch real keys or provider APIs from tests.
      BURNRATE_KEYCHAIN: "off",
      ANTHROPIC_ADMIN_KEY: "",
      OPENAI_ADMIN_KEY: "",
    },
  },
);
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
