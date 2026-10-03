import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

export type { DatabaseSync };

const require = createRequire(import.meta.url);

/**
 * Load node:sqlite without printing its "ExperimentalWarning" to the user's terminal.
 * Only that one warning is swallowed; every other warning still goes through.
 */
function loadSqlite(): typeof import("node:sqlite") {
  const original = process.emitWarning;
  process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
    const text = typeof warning === "string" ? warning : warning.message;
    if (/SQLite is an experimental feature/i.test(text)) return;
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    return require("node:sqlite") as typeof import("node:sqlite");
  } finally {
    process.emitWarning = original;
  }
}

let cached: typeof import("node:sqlite") | undefined;

/** True when this Node version ships node:sqlite without a flag (22.13+). */
export function sqliteAvailable(): boolean {
  try {
    cached ??= loadSqlite();
    return true;
  } catch {
    return false;
  }
}

export function openDatabase(path: string): DatabaseSync {
  cached ??= loadSqlite();
  const db = new cached.DatabaseSync(path);
  // Several BurnRate processes (dashboard, report, sync) may touch the file at once.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON;");
  return db;
}
