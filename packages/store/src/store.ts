import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { burnrateHome, type ProviderCostRow, type ProviderUsageRow, type UsageEvent } from "@burnrate/core";

export type { ProviderCostRow, ProviderUsageRow };
import { openDatabase, type DatabaseSync } from "./sqlite.js";

/** One timestamp format in the database (providers send both ...00Z and ...00.000Z), so range queries compare correctly. */
const iso = (s: string) => new Date(s).toISOString();

const SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      tool TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      project TEXT,
      session_id TEXT,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,
      speed TEXT,
      source TEXT NOT NULL
    );
    CREATE INDEX events_ts ON events (ts);

    CREATE TABLE provider_usage (
      provider TEXT NOT NULL,
      bucket_start TEXT NOT NULL,
      bucket_end TEXT NOT NULL,
      model TEXT NOT NULL,
      scope TEXT NOT NULL,
      uncached_input_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      cache_write_long_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      requests INTEGER,
      PRIMARY KEY (provider, bucket_start, model, scope)
    );

    CREATE TABLE provider_costs (
      provider TEXT NOT NULL,
      bucket_start TEXT NOT NULL,
      bucket_end TEXT NOT NULL,
      scope TEXT NOT NULL,
      item TEXT NOT NULL,
      model TEXT,
      amount_usd REAL NOT NULL,
      PRIMARY KEY (provider, bucket_start, scope, item)
    );

    CREATE TABLE sync_state (
      provider TEXT PRIMARY KEY,
      last_synced_at INTEGER NOT NULL,
      last_error TEXT
    );
  `,
};

/** Default database location: ~/.burnrate/burnrate.db (or $BURNRATE_HOME). */
export function defaultDatabasePath(): string {
  return join(burnrateHome(), "burnrate.db");
}

export class BurnrateStore {
  readonly db: DatabaseSync;

  constructor(readonly path: string = defaultDatabasePath()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = openDatabase(path);
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let v = row.user_version + 1; v <= SCHEMA_VERSION; v++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v}`);
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Save events so they outlive the tool's own log retention. A re-seen event replaces the
   * stored one only if it has more output tokens (a later line of the same streamed reply).
   * Returns how many rows were added or updated.
   */
  archiveEvents(events: Iterable<UsageEvent>): number {
    const stmt = this.db.prepare(`
      INSERT INTO events (id, ts, tool, provider, model, project, session_id, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, cache_write_1h_tokens, speed, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        output_tokens = excluded.output_tokens, input_tokens = excluded.input_tokens,
        cache_read_tokens = excluded.cache_read_tokens, cache_write_tokens = excluded.cache_write_tokens,
        cache_write_1h_tokens = excluded.cache_write_1h_tokens, ts = excluded.ts
      WHERE excluded.output_tokens > events.output_tokens`);
    return this.transaction(() => {
      let changed = 0;
      for (const e of events) {
        const r = stmt.run(
          e.id,
          Date.parse(e.timestamp),
          e.tool,
          e.provider,
          e.model,
          e.project ?? null,
          e.sessionId ?? null,
          e.inputTokens,
          e.outputTokens,
          e.cacheReadTokens ?? 0,
          e.cacheWriteTokens ?? 0,
          e.cacheWrite1hTokens ?? 0,
          e.speed ?? null,
          e.source,
        );
        changed += Number(r.changes);
      }
      return changed;
    });
  }

  /** Archived events at or after `since`, oldest first. */
  loadEvents(since?: Date, until?: Date): UsageEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE ts >= ? AND ts < ? ORDER BY ts")
      .all(since?.getTime() ?? 0, until?.getTime() ?? Number.MAX_SAFE_INTEGER) as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => {
      const e: UsageEvent = {
        id: r.id as string,
        timestamp: new Date(r.ts as number).toISOString(),
        tool: r.tool as string,
        provider: r.provider as string,
        model: r.model as string,
        inputTokens: r.input_tokens as number,
        outputTokens: r.output_tokens as number,
        source: r.source as UsageEvent["source"],
      };
      if (r.project) e.project = r.project as string;
      if (r.session_id) e.sessionId = r.session_id as string;
      if (r.cache_read_tokens) e.cacheReadTokens = r.cache_read_tokens as number;
      if (r.cache_write_tokens) e.cacheWriteTokens = r.cache_write_tokens as number;
      if (r.cache_write_1h_tokens) e.cacheWrite1hTokens = r.cache_write_1h_tokens as number;
      if (r.speed === "fast") e.speed = "fast";
      return e;
    });
  }

  eventCount(): number {
    return (this.db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n;
  }

  /** Replace provider usage for the buckets in `rows` (provider data for a day can be revised). */
  upsertProviderUsage(rows: ProviderUsageRow[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO provider_usage (provider, bucket_start, bucket_end, model, scope,
        uncached_input_tokens, cache_read_tokens, cache_write_tokens, cache_write_long_tokens, output_tokens, requests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.transaction(() => {
      for (const r of rows)
        stmt.run(
          r.provider,
          iso(r.bucketStart),
          iso(r.bucketEnd),
          r.model,
          r.scope,
          r.uncachedInputTokens,
          r.cacheReadTokens,
          r.cacheWriteTokens,
          r.cacheWriteLongTokens,
          r.outputTokens,
          r.requests ?? null,
        );
    });
  }

  /**
   * Replace all cost lines for a provider within [from, to). Costs for a day can change until the
   * provider finalizes them, so a sync rewrites its whole window instead of merging.
   */
  replaceProviderCosts(
    provider: ProviderCostRow["provider"],
    from: string,
    to: string,
    rows: ProviderCostRow[],
  ): void {
    const del = this.db.prepare(
      "DELETE FROM provider_costs WHERE provider = ? AND bucket_start >= ? AND bucket_start < ?",
    );
    const ins = this.db.prepare(`
      INSERT OR REPLACE INTO provider_costs (provider, bucket_start, bucket_end, scope, item, model, amount_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    this.transaction(() => {
      del.run(provider, iso(from), iso(to));
      for (const r of rows)
        ins.run(
          r.provider,
          iso(r.bucketStart),
          iso(r.bucketEnd),
          r.scope,
          r.item,
          r.model ?? null,
          r.amountUsd,
        );
    });
  }

  providerUsage(from: string, to: string, provider?: string): ProviderUsageRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM provider_usage WHERE bucket_start >= ? AND bucket_start < ? ${provider ? "AND provider = ?" : ""} ORDER BY bucket_start`,
      )
      .all(...[iso(from), iso(to), ...(provider ? [provider] : [])]) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      provider: r.provider as ProviderUsageRow["provider"],
      bucketStart: r.bucket_start as string,
      bucketEnd: r.bucket_end as string,
      model: r.model as string,
      scope: r.scope as string,
      uncachedInputTokens: r.uncached_input_tokens as number,
      cacheReadTokens: r.cache_read_tokens as number,
      cacheWriteTokens: r.cache_write_tokens as number,
      cacheWriteLongTokens: r.cache_write_long_tokens as number,
      outputTokens: r.output_tokens as number,
      ...(r.requests !== null && { requests: r.requests as number }),
    }));
  }

  providerCosts(from: string, to: string, provider?: string): ProviderCostRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM provider_costs WHERE bucket_start >= ? AND bucket_start < ? ${provider ? "AND provider = ?" : ""} ORDER BY bucket_start`,
      )
      .all(...[iso(from), iso(to), ...(provider ? [provider] : [])]) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      provider: r.provider as ProviderCostRow["provider"],
      bucketStart: r.bucket_start as string,
      bucketEnd: r.bucket_end as string,
      scope: r.scope as string,
      item: r.item as string,
      ...(r.model !== null && { model: r.model as string }),
      amountUsd: r.amount_usd as number,
    }));
  }

  setSyncState(provider: string, at: number, error?: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO sync_state (provider, last_synced_at, last_error) VALUES (?, ?, ?)")
      .run(provider, at, error ?? null);
  }

  syncState(): Array<{ provider: string; lastSyncedAt: number; lastError?: string }> {
    const rows = this.db.prepare("SELECT * FROM sync_state ORDER BY provider").all() as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      provider: r.provider as string,
      lastSyncedAt: r.last_synced_at as number,
      ...(r.last_error !== null && { lastError: r.last_error as string }),
    }));
  }
}
