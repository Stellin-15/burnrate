import { describe, expect, it } from "vitest";
import { eventCost, totalTokens } from "./cost.js";
import type { UsageEvent } from "./types.js";

const M = 1_000_000;

type Case = [string, Partial<UsageEvent> & { model: string }, number];

// Expected values are hand-computed from the published per-MTok prices in models.json.
const cases: Case[] = [
  ["Opus 5.5 input", { model: "claude-opus-5-5", inputTokens: M }, 4],
  ["Opus 5.5 output", { model: "claude-opus-5-5", outputTokens: M }, 20],
  ["Opus 5.5 cache read (0.05x)", { model: "claude-opus-5-5", cacheReadTokens: M }, 0.2],
  ["Opus 5.5 5m cache write", { model: "claude-opus-5-5", cacheWriteTokens: M }, 5],
  ["Opus 5.5 1h cache write", { model: "claude-opus-5-5", cacheWrite1hTokens: M }, 8],
  ["Fable 5.1 cache read (0.025x)", { model: "claude-fable-5-1", cacheReadTokens: M }, 0.25],
  ["Haiku 4.5 dated id, 1h write", { model: "claude-haiku-4-5-20251001", cacheWrite1hTokens: M }, 2],
  [
    // 10k*3 + 2k*15 + 50k*0.3 + 5k*3.75, all / 1M = 0.03 + 0.03 + 0.015 + 0.01875
    "Sonnet 4.5 mixed request",
    {
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 10_000,
      outputTokens: 2_000,
      cacheReadTokens: 50_000,
      cacheWriteTokens: 5_000,
    },
    0.09375,
  ],
  [
    // Anthropic's own worked example: Opus 5, 10k uncached + 40k cache reads + 15k output = $0.445 of tokens.
    "Opus 5 docs example",
    { model: "claude-opus-5", inputTokens: 10_000, cacheReadTokens: 40_000, outputTokens: 15_000 },
    0.445,
  ],
  ["Opus 5.5 fast input", { model: "claude-opus-5-5", inputTokens: M, speed: "fast" }, 8],
  ["Opus 5.5 fast output", { model: "claude-opus-5-5", outputTokens: M, speed: "fast" }, 40],
  [
    "Opus 5.5 fast cache read scales with input",
    { model: "claude-opus-5-5", cacheReadTokens: M, speed: "fast" },
    0.4,
  ],
  [
    "fast flag ignored on models without fast pricing",
    { model: "claude-haiku-4-5", inputTokens: M, speed: "fast" },
    1,
  ],
  ["zero tokens", { model: "claude-opus-5-5" }, 0],
];

describe("eventCost", () => {
  it.each(cases)("%s", (_name, partial, expected) => {
    const e = { inputTokens: 0, outputTokens: 0, ...partial };
    expect(eventCost(e)).toBeCloseTo(expected, 10);
  });

  it("returns undefined for unpriced models", () => {
    expect(eventCost({ model: "<synthetic>", inputTokens: 5, outputTokens: 5 })).toBeUndefined();
  });
});

describe("totalTokens", () => {
  it("adds every token category", () => {
    expect(
      totalTokens({
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        cacheWrite1hTokens: 5,
      }),
    ).toBe(15);
  });
});
