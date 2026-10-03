import { describe, expect, it } from "vitest";
import { computedCost, reconcile } from "./reconcile.js";
import type { ProviderCostRow, ProviderUsageRow } from "./types.js";

const M = 1_000_000;
const usage = (over: Partial<ProviderUsageRow>): ProviderUsageRow => ({
  provider: "anthropic",
  bucketStart: "2026-09-01T00:00:00.000Z",
  bucketEnd: "2026-09-02T00:00:00.000Z",
  model: "claude-opus-5-5",
  scope: "",
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWriteLongTokens: 0,
  outputTokens: 0,
  ...over,
});
const cost = (over: Partial<ProviderCostRow>): ProviderCostRow => ({
  provider: "anthropic",
  bucketStart: "2026-09-01T00:00:00.000Z",
  bucketEnd: "2026-09-02T00:00:00.000Z",
  scope: "",
  item: "x",
  amountUsd: 0,
  ...over,
});

describe("computedCost", () => {
  it("prices Anthropic rows including 1h cache writes (hand-checked)", () => {
    // Opus 5.5: 1M uncached $4 + 1M output $20 + 1M 5m write $5 + 1M 1h write $8 + 1M read $0.20
    const row = usage({
      uncachedInputTokens: M,
      outputTokens: M,
      cacheWriteTokens: M,
      cacheWriteLongTokens: M,
      cacheReadTokens: M,
    });
    expect(computedCost(row)).toBeCloseTo(37.2, 10);
  });

  it("leaves unknown models and non-Anthropic long cache writes unpriced", () => {
    expect(computedCost(usage({ model: "gpt-5", provider: "openai" }))).toBeUndefined();
    expect(computedCost(usage({ provider: "openai", cacheWriteLongTokens: 5 }))).toBeUndefined();
  });
});

describe("reconcile", () => {
  it("compares billed and list-price cost per day", () => {
    const rows = reconcile(
      [usage({ outputTokens: M })], // $20 at list price
      [cost({ amountUsd: 18, model: "claude-opus-5-5" }), cost({ amountUsd: 1, item: "Web Search Usage" })],
      "day",
    );
    expect(rows).toEqual([
      {
        key: "2026-09-01",
        provider: "anthropic",
        reportedUsd: 19,
        computedUsd: 20,
        differenceUsd: -1,
        unpricedRows: 0,
      },
    ]);
  });

  it("groups by model, merging dated ids and putting non-model costs under (other)", () => {
    const rows = reconcile(
      [usage({ model: "claude-haiku-4-5-20251001", outputTokens: M })],
      [cost({ amountUsd: 5, model: "claude-haiku-4-5" }), cost({ amountUsd: 2 })],
      "model",
    );
    expect(rows.map((r) => [r.key, r.reportedUsd, r.computedUsd])).toEqual([
      ["claude-haiku-4-5", 5, 5],
      ["(other)", 2, undefined],
    ]);
  });

  it("doesn't claim a difference when some usage is unpriced", () => {
    const rows = reconcile(
      [usage({ provider: "openai", model: "gpt-5", outputTokens: 10 })],
      [cost({ provider: "openai", amountUsd: 3 })],
      "day",
    );
    expect(rows[0]).toMatchObject({ reportedUsd: 3, unpricedRows: 1 });
    expect(rows[0]!.differenceUsd).toBeUndefined();
  });
});
