import type { UsageEvent } from "@burnrate/core";
import { sqliteAvailable } from "./sqlite.js";
import { BurnrateStore, defaultDatabasePath } from "./store.js";

/** Open the store, or return undefined (with a reason) if this Node can't run node:sqlite or the file is unusable. */
export function openStoreQuietly(path = defaultDatabasePath()): { store?: BurnrateStore; problem?: string } {
  if (!sqliteAvailable()) return { problem: "history needs Node 22.13+ (built-in SQLite)" };
  try {
    return { store: new BurnrateStore(path) };
  } catch (err) {
    return { problem: `couldn't open ${path}: ${(err as Error).message}` };
  }
}

/**
 * Combine freshly read events with the archive: archive the fresh ones, then return the union
 * for the time range, deduped by id (fresh data wins when it has more output tokens).
 */
export function mergeHistory(
  store: BurnrateStore,
  fresh: UsageEvent[],
  since?: Date,
  until?: Date,
): UsageEvent[] {
  store.archiveEvents(fresh);
  const byId = new Map<string, UsageEvent>();
  for (const e of store.loadEvents(since, until)) byId.set(e.id, e);
  for (const e of fresh) {
    const prev = byId.get(e.id);
    if (!prev || e.outputTokens >= prev.outputTokens) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
