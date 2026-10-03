import { describe, expect, it } from "vitest";
import { budgetStatus } from "./budgets.js";
import { compareModels, repriceEvents } from "./calculator.js";
import { resolveConfig } from "./config.js";
import type { UsageEvent } from "./types.js";

const M = 1_000_000;

describe("compareModels", () => {
  // 10k input + 1k output per request, 100 requests/day, 30-day month.
  const w = { inputTokens: 10_000, outputTokens: 1_000, requestsPerDay: 100 };

  it("prices a workload per request, day, and month (hand-checked)", () => {
    const quotes = compareModels(w, { models: ["claude-sonnet-5-5", "claude-haiku-4-5", "claude-opus-5-5"] });
    const byId = Object.fromEntries(quotes.map((q) => [q.model.id, q]));
    // Sonnet 5.5: 10k*$2 + 1k*$10 = $0.02 + $0.01
    expect(byId["claude-sonnet-5-5"]!.perRequest.total).toBeCloseTo(0.03, 10);
    expect(byId["claude-sonnet-5-5"]!.perDay).toBeCloseTo(3, 10);
    expect(byId["claude-sonnet-5-5"]!.perMonth).toBeCloseTo(90, 10);
    // Haiku 4.5: 10k*$1 + 1k*$5 = $0.015 -> $45/month
    expect(byId["claude-haiku-4-5"]!.perMonth).toBeCloseTo(45, 10);
    // Opus 5.5: 10k*$4 + 1k*$20 = $0.06 -> $180/month
    expect(byId["claude-opus-5-5"]!.perMonth).toBeCloseTo(180, 10);
    expect(quotes.map((q) => q.model.id)).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
    ]);
  });

  it("includes cache tokens", () => {
    const [q] = compareModels({ ...w, cacheReadTokens: 100_000 }, { models: ["claude-opus-5-5"] });
    // + 100k * $0.20 = $0.02 per request
    expect(q!.perRequest.total).toBeCloseTo(0.08, 10);
  });

  it("hides retired models unless asked", () => {
    const ids = compareModels(w).map((q) => q.model.id);
    expect(ids).not.toContain("claude-3-5-haiku");
    expect(compareModels(w, { includeRetired: true }).map((q) => q.model.id)).toContain("claude-3-5-haiku");
  });
});

let n = 0;
const ev = (model: string, extra: Partial<UsageEvent> = {}): UsageEvent => ({
  id: `e${n++}`,
  timestamp: "2026-10-01T10:00:00Z",
  tool: "claude-code",
  provider: "anthropic",
  model,
  inputTokens: 0,
  outputTokens: 0,
  source: "local-log",
  ...extra,
});

describe("repriceEvents", () => {
  const events = [
    ev("claude-opus-5-5", { inputTokens: M }), // $4 actual, $2 on Sonnet 5.5
    ev("claude-haiku-4-5-20251001", { outputTokens: M }), // $5 actual, $10 on Sonnet 5.5
    ev("mystery-model", { inputTokens: M }),
  ];

  it("re-prices every priced event at the target's rates", () => {
    const r = repriceEvents(events, "claude-sonnet-5-5")!;
    expect(r.actualUsd).toBeCloseTo(9, 10);
    expect(r.repricedUsd).toBeCloseTo(12, 10);
    expect(r.requests).toBe(2);
    expect(r.skippedUnpriced).toBe(1);
    expect(r.byModel.map((m) => m.model)).toEqual(["claude-haiku-4-5", "claude-opus-5-5"]);
  });

  it("can limit to one source model", () => {
    const r = repriceEvents(events, "claude-sonnet-5-5", { onlyModel: "claude-opus-5-5" })!;
    expect(r.actualUsd).toBeCloseTo(4, 10);
    expect(r.repricedUsd).toBeCloseTo(2, 10);
  });

  it("drops fast mode when the target has no fast pricing", () => {
    const fast = [ev("claude-opus-5-5", { outputTokens: M, speed: "fast" })]; // $40 actual
    expect(repriceEvents(fast, "claude-haiku-4-5")!.repricedUsd).toBeCloseTo(5, 10);
    expect(repriceEvents(fast, "claude-opus-5")!.repricedUsd).toBeCloseTo(50, 10);
  });

  it("returns undefined for an unknown target", () => {
    expect(repriceEvents(events, "gpt-9")).toBeUndefined();
  });
});

describe("budgetStatus", () => {
  // Wednesday Oct 7 2026, noon local time. Haiku 4.5 at 1M input = exactly $1 per event.
  const now = new Date(2026, 9, 7, 12);
  const at = (d: Date) => ev("claude-haiku-4-5", { inputTokens: M, timestamp: d.toISOString() });
  const events = [
    at(new Date(2026, 8, 30, 9)), // previous month
    at(new Date(2026, 9, 1, 9)), // this month, previous week
    at(new Date(2026, 9, 5, 9)), // Monday this week
    at(new Date(2026, 9, 7, 8)), // today
    at(new Date(2026, 9, 7, 9)), // today
  ];

  it("totals each calendar period and projects pace", () => {
    const [daily, weekly, monthly] = budgetStatus(events, { daily: 4, weekly: 3, monthly: 10 }, now);
    expect(daily).toMatchObject({ period: "daily", spentUsd: 2, percent: 50, state: "ok" });
    expect(daily!.projectedUsd).toBeCloseTo(4, 6); // half the day gone, $2 spent
    expect(weekly).toMatchObject({ spentUsd: 3, percent: 100, state: "over" });
    expect(monthly!.spentUsd).toBeCloseTo(4, 10);
    expect(monthly!.state).toBe("pace"); // $4 in 6.5 days -> ~$19 by month end
  });

  it("warns at the threshold and skips unset budgets", () => {
    const [daily] = budgetStatus(events, { daily: 2.4 }, now);
    expect(daily!.state).toBe("warn"); // 83%
    expect(budgetStatus(events, {}, now)).toEqual([]);
  });
});

describe("budgets config", () => {
  it("accepts valid periods and warns on bad ones", () => {
    const { config, warnings } = resolveConfig({ budgets: { monthly: 200, yearly: 5, daily: -1 } });
    expect(config.budgets).toEqual({ monthly: 200 });
    expect(warnings).toHaveLength(2);
  });
});
