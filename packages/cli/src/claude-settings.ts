import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface StatusLineSetting {
  type: "command";
  command: string;
  padding?: number;
  refreshInterval?: number;
}

/** What we remember so `uninstall` can put things back exactly. */
export interface InstallRecord {
  settingsPath: string;
  installedAt: string;
  backupPath?: string;
  /** The statusLine that was there before us; undefined means there was none. */
  previousStatusLine?: unknown;
}

export type InstallResult =
  | {
      ok: true;
      changed: boolean;
      backupPath?: string;
      previous?: unknown;
      next: StatusLineSetting;
      record: InstallRecord;
    }
  | {
      ok: false;
      reason: "invalid-json" | "not-object" | "foreign-statusline";
      message: string;
      existing?: unknown;
    };

const isOurs = (v: unknown): boolean =>
  !!v &&
  typeof v === "object" &&
  typeof (v as { command?: unknown }).command === "string" &&
  /burnrate/i.test((v as { command: string }).command) &&
  /statusline/.test((v as { command: string }).command);

function readSettings(
  path: string,
):
  | { ok: true; data: Record<string, unknown>; raw?: string }
  | { ok: false; reason: "invalid-json" | "not-object"; message: string } {
  if (!existsSync(path)) return { ok: true, data: {} };
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) return { ok: true, data: {}, raw };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      reason: "invalid-json",
      message: `${path} is not valid JSON (${(err as Error).message}). Fix it first; nothing was changed.`,
    };
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return {
      ok: false,
      reason: "not-object",
      message: `${path} must contain a JSON object. Nothing was changed.`,
    };
  return { ok: true, data: data as Record<string, unknown>, raw };
}

function writeSettings(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.burnrate.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

/**
 * Add or update the statusLine entry in Claude Code's settings.json.
 * - Refuses to replace a status line that isn't ours unless `force` is set.
 * - Backs up the original file before the first change.
 * - Leaves every other setting untouched.
 */
export function installStatusLine(
  settingsPath: string,
  next: StatusLineSetting,
  opts: { force?: boolean; dryRun?: boolean; now?: Date } = {},
): InstallResult {
  const read = readSettings(settingsPath);
  if (!read.ok) return read;
  const previous = read.data.statusLine;
  if (previous !== undefined && !isOurs(previous) && !opts.force) {
    return {
      ok: false,
      reason: "foreign-statusline",
      message:
        "Claude Code already has a custom statusLine. Re-run with --force to replace it (a backup is kept, and `burnrate uninstall claude-code` restores it).",
      existing: previous,
    };
  }
  const record: InstallRecord = {
    settingsPath,
    installedAt: (opts.now ?? new Date()).toISOString(),
    ...(previous !== undefined && !isOurs(previous) && { previousStatusLine: previous }),
  };
  const changed = JSON.stringify(previous) !== JSON.stringify(next);
  if (!changed || opts.dryRun) return { ok: true, changed, previous, next, record };

  let backupPath: string | undefined;
  if (read.raw !== undefined) {
    const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
    backupPath = `${settingsPath}.burnrate-backup-${stamp}`;
    copyFileSync(settingsPath, backupPath);
    record.backupPath = backupPath;
  }
  writeSettings(settingsPath, { ...read.data, statusLine: next });
  return { ok: true, changed, backupPath, previous, next, record };
}

export type UninstallResult =
  | { ok: true; changed: boolean; restored?: unknown }
  | { ok: false; reason: "invalid-json" | "not-object" | "foreign-statusline"; message: string };

/** Remove our statusLine, restoring whatever was there before install (if recorded). */
export function uninstallStatusLine(settingsPath: string, record?: InstallRecord): UninstallResult {
  const read = readSettings(settingsPath);
  if (!read.ok) return read;
  const current = read.data.statusLine;
  if (current === undefined) return { ok: true, changed: false };
  if (!isOurs(current))
    return {
      ok: false,
      reason: "foreign-statusline",
      message: "The current statusLine isn't BurnRate's, so it was left alone.",
    };
  const { statusLine: _drop, ...rest } = read.data;
  const restored = record?.previousStatusLine;
  writeSettings(settingsPath, restored === undefined ? rest : { ...rest, statusLine: restored });
  return { ok: true, changed: true, restored };
}
