import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UsageEvent } from "@burnrate/core";
import { BurnrateStore, mergeHistory, type ProviderCostRow, type ProviderUsageRow } from "./index.js";

const ev = (id: string, iso: string, output = 10, extra: Partial<UsageEvent> = {}): UsageEvent => ({
  id,
  timestamp: iso,
  tool: "claude-code",
  provider: "anthropic",
  model: "claude-opus-5-5",
  inputTokens: 5,
  outputTokens: output,
  source: "local-log",
  ...extra,
});

const stores: BurnrateStore[] = [];
const open = (path = ":memory:") => {
  const s = new BurnrateStore(path);
  stores.push(s);
  return s;
};
afterEach(() => {
  while (stores.length) stores.pop()!.close();
});

describe("event archive", () => {
  it("round-trips every field", () => {
    const s = open();
    const e = ev("a", "2026-09-01T10:00:00.000Z", 10, {
      project: "/w/api",
      sessionId: "s1",
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      cacheWrite1hTokens: 30,
      speed: "fast",
    });
    s.archiveEvents([e]);
    expect(s.loadEvents()).toEqual([e]);
  });

  it("keeps the line with the most output tokens for a streamed reply", () => {
    const s = open();
    s.archiveEvents([ev("a", "2026-09-01T10:00:00Z", 5)]);
    expect(s.archiveEvents([ev("a", "2026-09-01T10:00:01Z", 500)])).toBe(1);
    expect(s.archiveEvents([ev("a", "2026-09-01T10:00:00Z", 5)])).toBe(0);
    expect(s.loadEvents()[0]!.outputTokens).toBe(500);
  });

  it("filters by time", () => {
    const s = open();
    s.archiveEvents([ev("old", "2026-08-01T00:00:00Z"), ev("new", "2026-09-15T00:00:00Z")]);
    expect(s.loadEvents(new Date("2026-09-01T00:00:00Z")).map((e) => e.id)).toEqual(["new"]);
  });

  it("keeps history after the source logs are gone", () => {
    const s = open();
    const old = ev("old", "2026-07-01T00:00:00Z");
    mergeHistory(s, [old]);
    // A later read where the transcript containing `old` has been deleted:
    const merged = mergeHistory(s, [ev("new", "2026-09-15T00:00:00Z")]);
    expect(merged.map((e) => e.id)).toEqual(["old", "new"]);
  });

  it("persists to disk and reopens", () => {
    const path = join(mkdtempSync(join(tmpdir(), "burnrate-db-")), "b.db");
    const a = new BurnrateStore(path);
    a.archiveEvents([ev("a", "2026-09-01T00:00:00Z")]);
    a.close();
    const b = open(path);
    expect(b.eventCount()).toBe(1);
  });
});

describe("provider data", () => {
  const usage: ProviderUsageRow = {
    provider: "anthropic",
    bucketStart: "2026-09-01T00:00:00Z",
    bucketEnd: "2026-09-02T00:00:00Z",
    model: "claude-opus-5-5",
    scope: "",
    uncachedInputTokens: 100,
    cacheReadTokens: 1000,
    cacheWriteTokens: 10,
    cacheWriteLongTokens: 20,
    outputTokens: 50,
  };
  const cost = (item: string, amountUsd: number, day = "2026-09-01"): ProviderCostRow => ({
    provider: "anthropic",
    bucketStart: `${day}T00:00:00Z`,
    bucketEnd: `${day}T23:59:59Z`,
    scope: "",
    item,
    model: "claude-opus-5-5",
    amountUsd,
  });

  it("upserts usage by bucket, model, and scope", () => {
    const s = open();
    s.upsertProviderUsage([usage]);
    s.upsertProviderUsage([{ ...usage, outputTokens: 75, requests: 3 }]);
    expect(s.providerUsage("2026-09-01", "2026-10-01")).toEqual([
      { ...usage, outputTokens: 75, requests: 3 },
    ]);
  });

  it("replaces a cost window wholesale so revised days don't double count", () => {
    const s = open();
    s.replaceProviderCosts("anthropic", "2026-09-01", "2026-09-03", [cost("input", 1), cost("output", 2)]);
    s.replaceProviderCosts("anthropic", "2026-09-01", "2026-09-03", [cost("input", 1.5)]);
    expect(s.providerCosts("2026-09-01", "2026-10-01").map((c) => [c.item, c.amountUsd])).toEqual([
      ["input", 1.5],
    ]);
  });

  it("tracks sync state per provider", () => {
    const s = open();
    s.setSyncState("anthropic", 1000);
    s.setSyncState("openai", 2000, "401 Unauthorized");
    expect(s.syncState()).toEqual([
      { provider: "anthropic", lastSyncedAt: 1000 },
      { provider: "openai", lastSyncedAt: 2000, lastError: "401 Unauthorized" },
    ]);
  });
});
