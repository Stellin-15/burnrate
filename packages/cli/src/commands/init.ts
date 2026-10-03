import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { burnrateHome, loadConfig } from "@burnrate/core";
import { claudeConfigDirs, claudeSettingsPath, loadClaudeCodeEvents } from "@burnrate/adapter-claude-code";
import {
  installStatusLine,
  uninstallStatusLine,
  type InstallRecord,
  type StatusLineSetting,
} from "../claude-settings.js";
import { readJson, writeJsonQuiet } from "../summary.js";

const recordPath = () => join(burnrateHome(), "state", "claude-code-install.json");

/** Forward slashes keep the command working when Claude Code runs it through Git Bash on Windows. */
const slash = (p: string) => p.replace(/\\/g, "/");
const quote = (p: string) => (/[\s"]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p);

/**
 * The command Claude Code should run. We pin the absolute node + script paths rather than relying on PATH,
 * because Claude Code may launch with a different PATH than your shell (and `npx` adds ~1s per refresh).
 */
export function defaultStatuslineCommand(): string {
  const script = process.argv[1] ? resolve(process.argv[1]) : fileURLToPath(import.meta.url);
  return `${quote(slash(process.execPath))} ${quote(slash(script))} statusline`;
}

export interface InitArgs {
  tool?: string;
  force?: boolean;
  dryRun?: boolean;
  command?: string;
  refresh?: number;
}

export async function runInit(args: InitArgs): Promise<number> {
  if (args.tool !== "claude-code") {
    console.error(
      args.tool ? `Unknown tool "${args.tool}". Supported: claude-code` : "Usage: burnrate init claude-code",
    );
    return 2;
  }
  const settingsPath = claudeSettingsPath();
  const next: StatusLineSetting = {
    type: "command",
    command: args.command ?? defaultStatuslineCommand(),
    padding: 0,
  };
  // Reset countdowns tick even while idle only if Claude Code re-runs us; 60s keeps them honest at negligible cost.
  next.refreshInterval = args.refresh ?? 60;

  const result = installStatusLine(settingsPath, next, { force: args.force, dryRun: args.dryRun });
  if (!result.ok) {
    console.error(result.message);
    if (result.existing !== undefined)
      console.error(`\nCurrent statusLine:\n${JSON.stringify(result.existing, null, 2)}`);
    return 1;
  }

  if (args.dryRun) {
    console.log(`Dry run: would set statusLine in ${settingsPath} to:\n${JSON.stringify(next, null, 2)}`);
    if (result.previous !== undefined)
      console.log(`\nReplacing:\n${JSON.stringify(result.previous, null, 2)}`);
    return 0;
  }
  if (!result.changed) {
    console.log(`BurnRate is already installed in ${settingsPath}. Nothing to do.`);
  } else {
    const prior = readJson<InstallRecord>(recordPath());
    // Keep the original pre-BurnRate status line across re-installs.
    const record: InstallRecord =
      prior?.previousStatusLine !== undefined && result.record.previousStatusLine === undefined
        ? { ...result.record, previousStatusLine: prior.previousStatusLine }
        : result.record;
    writeJsonQuiet(recordPath(), record);
    console.log(`✓ Added BurnRate status line to ${settingsPath}`);
    if (result.backupPath) console.log(`  Backup of your previous settings: ${result.backupPath}`);
  }

  // Warm the transcript cache so the first status line render is fast.
  const { config } = loadConfig();
  const dirs = claudeConfigDirs(config.claudeDirs);
  if (dirs.length) {
    const started = Date.now();
    const events = loadClaudeCodeEvents({
      dirs,
      since: new Date(Date.now() - 8 * 86_400_000),
      cachePath: join(burnrateHome(), "cache", "claude-code-events.json"),
    });
    console.log(`  Indexed ${events.length} requests from the last 8 days in ${Date.now() - started}ms.`);
  } else {
    console.log(
      "  No Claude Code transcripts found yet. That's fine; the meter fills in once you use Claude Code.",
    );
  }
  console.log("\nSend a message in Claude Code (or restart it) to see the meter.");
  console.log("Preview themes:  burnrate statusline --demo --theme minimal");
  console.log("Undo:            burnrate uninstall claude-code");
  return 0;
}

export async function runUninstall(args: { tool?: string }): Promise<number> {
  if (args.tool !== "claude-code") {
    console.error("Usage: burnrate uninstall claude-code");
    return 2;
  }
  const settingsPath = claudeSettingsPath();
  const record = readJson<InstallRecord>(recordPath());
  const result = uninstallStatusLine(
    settingsPath,
    record?.settingsPath === settingsPath ? record : undefined,
  );
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  if (!result.changed) console.log(`No statusLine in ${settingsPath}. Nothing to do.`);
  else if (result.restored !== undefined)
    console.log(`✓ Removed BurnRate and restored your previous status line in ${settingsPath}`);
  else console.log(`✓ Removed BurnRate status line from ${settingsPath}`);
  return 0;
}
