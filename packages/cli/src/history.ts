import type { UsageEvent } from "@burnrate/core";
import { loadClaudeCodeEvents } from "@burnrate/adapter-claude-code";
import { mergeHistory, openStoreQuietly, type BurnrateStore } from "@burnrate/store";

export interface HistoryResult {
  events: UsageEvent[];
  /** Why the archive wasn't used, if it wasn't. Reads still work from transcripts alone. */
  problem?: string;
}

/**
 * Claude Code usage from transcripts plus BurnRate's archive, so history survives
 * Claude Code deleting old transcripts. Pass `store` to reuse an open connection.
 */
export function loadClaudeHistory(opts: {
  dirs: string[];
  since?: Date;
  until?: Date;
  cachePath?: string;
  store?: BurnrateStore;
}): HistoryResult {
  const fresh = opts.dirs.length
    ? loadClaudeCodeEvents({ dirs: opts.dirs, since: opts.since, cachePath: opts.cachePath })
    : [];
  const opened = opts.store ? { store: opts.store } : openStoreQuietly();
  if (!opened.store) return { events: fresh, problem: opened.problem };
  try {
    return { events: mergeHistory(opened.store, fresh, opts.since, opts.until) };
  } catch (err) {
    return { events: fresh, problem: `history unavailable: ${(err as Error).message}` };
  } finally {
    if (!opts.store) opened.store.close();
  }
}
