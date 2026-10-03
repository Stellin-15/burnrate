import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { burnrateHome, loadConfig, type ProviderId, type UsageEvent } from "@burnrate/core";
import { claudeConfigDirs } from "@burnrate/adapter-claude-code";
import { openStoreQuietly, type BurnrateStore } from "@burnrate/store";
import pkg from "../../package.json" with { type: "json" };
import { loadClaudeHistory } from "../history.js";
import { PROVIDERS, osKeychain, resolveKey } from "../keys.js";
import { createDashboardServer } from "../server.js";
import type { StatusSnapshot } from "../snapshot.js";
import { readJson } from "../summary.js";
import { syncProvider } from "../sync.js";
import { explainProviderError } from "./keys.js";

export interface DashboardArgs {
  port?: number;
  open?: boolean;
}

/** Built UI ships next to the CLI bundle as dist/dashboard/. */
function findStaticDir(): string | undefined {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const candidate of [join(here, "dashboard"), join(here, "..", "dashboard")]) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return undefined;
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], {
      stdio: "ignore",
      detached: true,
      windowsVerbatimArguments: true,
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The URL is printed anyway.
  }
}

export async function runDashboard(args: DashboardArgs): Promise<number> {
  const { config, warnings } = loadConfig();
  for (const w of warnings) console.error(`config: ${w}`);
  const dirs = claudeConfigDirs(config.claudeDirs);
  if (!dirs.length)
    console.error("No Claude Code data found yet. The dashboard will be empty until you use Claude Code.");

  const cachePath = join(burnrateHome(), "cache", "claude-code-history.json");
  // One connection for the dashboard's lifetime; history survives Claude Code's transcript cleanup.
  const { store, problem } = openStoreQuietly();
  if (problem) console.error(`note: ${problem}; the dashboard will show transcripts only.`);
  let events: UsageEvent[] = [];
  let loadedAt = 0;
  const loadEvents = () => {
    // Incremental reads make refreshes cheap; cap at one per 5 seconds anyway.
    if (Date.now() - loadedAt > 5000) {
      events = loadClaudeHistory({ dirs, cachePath, store }).events;
      loadedAt = Date.now();
    }
    return events;
  };
  const started = Date.now();
  loadEvents();

  const token = process.env.BURNRATE_DASHBOARD_TOKEN || randomBytes(24).toString("base64url");
  const staticDir = findStaticDir();
  const snapshotPath = join(burnrateHome(), "state", "last-status.json");
  const server = createDashboardServer({
    loadEvents,
    config,
    token,
    staticDir,
    version: pkg.version,
    loadSpend: store
      ? (from, to) => ({
          usage: store.providerUsage(from, to),
          costs: store.providerCosts(from, to),
          syncState: store.syncState(),
        })
      : undefined,
    loadSnapshot: () => readJson<StatusSnapshot>(snapshotPath),
  });

  const basePort = args.port ?? 4777;
  const port = await new Promise<number>((resolvePort, reject) => {
    let attempt = 0;
    const tryListen = (p: number) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        // Only hunt for a free port when the user didn't ask for a specific one.
        if (err.code === "EADDRINUSE" && args.port === undefined && attempt++ < 20) tryListen(p + 1);
        else reject(err);
      });
      server.listen(p, "127.0.0.1", () => resolvePort((server.address() as { port: number }).port));
    };
    tryListen(basePort);
  }).catch((err: NodeJS.ErrnoException) => {
    console.error(
      err.code === "EADDRINUSE" ? `Port ${basePort} is in use. Try --port <number>.` : err.message,
    );
    return -1;
  });
  if (port < 0) return 1;

  // The token travels in the URL fragment, which browsers never send to servers or put in Referer headers.
  const url = `http://127.0.0.1:${port}/#token=${token}`;
  console.log(`BurnRate dashboard: ${url}`);
  console.log(
    `  ${events.length} requests loaded in ${Date.now() - started}ms. Only this computer can connect.`,
  );
  if (!staticDir) console.log("  UI assets not found (API only). Build them with `pnpm build`.");
  console.log("  Press Ctrl+C to stop.");
  if (args.open !== false && staticDir) openBrowser(url);

  // While the dashboard is open, keep provider spend fresh for providers that have a key.
  // This is the only time the dashboard goes online, and only if you added a key.
  const stopSync = store ? await startBackgroundSync(store) : () => {};

  await new Promise<void>((resolveStop) => {
    const stop = () => {
      server.closeAllConnections();
      server.close(() => {
        stopSync();
        store?.close();
        resolveStop();
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

const SYNC_EVERY_MS = 15 * 60_000;

async function startBackgroundSync(store: BurnrateStore): Promise<() => void> {
  const kc = await osKeychain();
  const keychain = "error" in kc ? undefined : kc;
  const targets = (Object.keys(PROVIDERS) as ProviderId[]).flatMap((p) => {
    const k = resolveKey(p, keychain);
    return k ? [{ provider: p, key: k.key }] : [];
  });
  if (!targets.length) return () => {};

  const run = async () => {
    for (const { provider, key } of targets) {
      const last = store.syncState().find((s) => s.provider === provider);
      // A fresh install backfills 30 days; afterwards the last 3 days are enough to pick up revisions.
      const days = last && !last.lastError ? 3 : 30;
      try {
        await syncProvider(provider, key, store, { days });
      } catch (err) {
        console.error(`  sync: ${explainProviderError(provider, err)}`);
      }
    }
  };
  console.log(
    `  Syncing ${targets.map((t) => PROVIDERS[t.provider].label).join(" and ")} spend every 15 minutes while open.`,
  );
  void run();
  const timer = setInterval(() => void run(), SYNC_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
