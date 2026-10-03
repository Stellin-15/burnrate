import { describe, expect, it } from "vitest";
import { findModelPricing, normalizeModelId, pricingTable, validatePricingTable } from "./index.js";

describe("models.json", () => {
  it("passes validation", () => {
    expect(validatePricingTable(pricingTable)).toEqual([]);
  });

  it("matches the published Opus 5.5 rates", () => {
    expect(findModelPricing("claude-opus-5-5")?.prices).toEqual({
      input: 4,
      output: 20,
      cacheWrite5m: 5,
      cacheWrite1h: 8,
      cacheRead: 0.2,
    });
  });
});

describe("normalizeModelId", () => {
  it.each([
    ["claude-sonnet-4-5-20250929", "claude-sonnet-4-5"],
    ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
    ["us.anthropic.claude-opus-4-1-20250805-v1:0", "claude-opus-4-1"],
    ["anthropic.claude-haiku-4-5-20251001-v1:0", "claude-haiku-4-5"],
    ["claude-opus-4-1@20250805", "claude-opus-4-1"],
    ["anthropic/claude-haiku-4-5", "claude-haiku-4-5"],
    ["claude-opus-5-5[1m]", "claude-opus-5-5"],
    ["Claude-Opus-5", "claude-opus-5"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeModelId(raw)).toBe(expected);
  });
});

describe("findModelPricing", () => {
  it("does not confuse claude-opus-4 with claude-opus-4-5", () => {
    expect(findModelPricing("claude-opus-4-20250514")?.prices.input).toBe(15);
    expect(findModelPricing("claude-opus-4-5-20251101")?.prices.input).toBe(5);
  });

  it("resolves aliases", () => {
    expect(findModelPricing("claude-3-5-haiku-20241022")?.id).toBe("claude-3-5-haiku");
    expect(findModelPricing("claude-haiku-3-5")?.id).toBe("claude-3-5-haiku");
  });

  it("returns undefined for unknown models", () => {
    expect(findModelPricing("<synthetic>")).toBeUndefined();
    expect(findModelPricing("gpt-9")).toBeUndefined();
  });
});

describe("validatePricingTable", () => {
  const good = pricingTable.models[0]!;

  it("rejects negative prices and missing sources", () => {
    const bad = { ...good, source: "", prices: { ...good.prices, input: -1 } };
    const errors = validatePricingTable({ ...pricingTable, models: [bad] }).join("\n");
    expect(errors).toMatch(/prices\.input/);
    expect(errors).toMatch(/source/);
  });

  it("rejects duplicate ids", () => {
    expect(validatePricingTable({ ...pricingTable, models: [good, good] })).not.toEqual([]);
  });

  it("rejects an alias that collides with another model id", () => {
    const other = { ...pricingTable.models[1]!, aliases: [good.id] };
    expect(validatePricingTable({ ...pricingTable, models: [good, other] })).not.toEqual([]);
  });
});
