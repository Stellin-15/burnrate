import { findModelPricing, type ModelPricing } from "@burnrate/pricing";
import type { UsageEvent } from "./types.js";

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

type TokenCounts = Pick<
  UsageEvent,
  "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "cacheWrite1hTokens" | "speed"
>;

const PER_TOKEN = 1 / 1_000_000;

/** Exact USD cost of a set of token counts at a given model's list price. */
export function costFromPricing(t: TokenCounts, pricing: ModelPricing): CostBreakdown {
  const p = pricing.prices;
  let inputRate = p.input;
  let outputRate = p.output;
  let readRate = p.cacheRead;
  let write5mRate = p.cacheWrite5m;
  let write1hRate = p.cacheWrite1h;

  // Fast mode replaces the base input/output rates; cache multipliers stack on top of the new input rate.
  if (t.speed === "fast" && pricing.fastModePrices && p.input > 0) {
    const scale = pricing.fastModePrices.input / p.input;
    inputRate = pricing.fastModePrices.input;
    outputRate = pricing.fastModePrices.output;
    readRate *= scale;
    write5mRate *= scale;
    write1hRate *= scale;
  }

  const input = t.inputTokens * inputRate * PER_TOKEN;
  const output = t.outputTokens * outputRate * PER_TOKEN;
  const cacheRead = (t.cacheReadTokens ?? 0) * readRate * PER_TOKEN;
  const cacheWrite =
    ((t.cacheWriteTokens ?? 0) * write5mRate + (t.cacheWrite1hTokens ?? 0) * write1hRate) * PER_TOKEN;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

/** Cost of one event, or undefined if the model isn't in the pricing table. */
export function eventCost(e: TokenCounts & { model: string }): number | undefined {
  const pricing = findModelPricing(e.model);
  return pricing ? costFromPricing(e, pricing).total : undefined;
}

/** All tokens that count toward usage (cache reads included). */
export function totalTokens(e: TokenCounts): number {
  return (
    e.inputTokens + e.outputTokens + (e.cacheReadTokens ?? 0) + (e.cacheWriteTokens ?? 0) + (e.cacheWrite1hTokens ?? 0)
  );
}
