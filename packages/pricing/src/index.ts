import data from "../models.json" with { type: "json" };
import type { ModelPricing, PricingTable } from "./types.js";

export type { ModelPricing, ModelStatus, PricingTable, TokenPrices } from "./types.js";
export { validatePricingTable } from "./validate.js";

export const pricingTable: PricingTable = data as PricingTable;

/**
 * Reduce the many spellings of a model id to the canonical form used in models.json:
 *   "claude-sonnet-4-5-20250929"                  -> "claude-sonnet-4-5"
 *   "us.anthropic.claude-opus-4-1-20250805-v1:0"  -> "claude-opus-4-1"   (Bedrock)
 *   "claude-opus-4-1@20250805"                    -> "claude-opus-4-1"   (Vertex)
 *   "anthropic/claude-haiku-4-5"                  -> "claude-haiku-4-5"  (OpenRouter-style)
 *   "claude-opus-5-5[1m]"                         -> "claude-opus-5-5"
 */
export function normalizeModelId(raw: string): string {
  let id = raw.trim().toLowerCase();
  id = id.replace(/\[[^\]]*\]$/, "");
  id = id.slice(id.lastIndexOf("/") + 1);
  id = id.replace(/^(?:[a-z]{2,6}\.)?anthropic\./, "");
  id = id.replace(/-v\d+(?::\d+)?$/, "");
  id = id.replace(/@.*$/, "");
  id = id.replace(/-\d{8}$/, "");
  id = id.replace(/-latest$/, "");
  return id;
}

/** Build a memoized lookup over a pricing table (exact match after normalization, never prefix match). */
export function createPricingLookup(
  table: PricingTable = pricingTable,
): (model: string) => ModelPricing | undefined {
  const index = new Map<string, ModelPricing>();
  for (const m of table.models) {
    index.set(m.id, m);
    for (const a of m.aliases ?? []) index.set(a, m);
  }
  const memo = new Map<string, ModelPricing | undefined>();
  return (model) => {
    if (memo.has(model)) return memo.get(model);
    const hit = index.get(normalizeModelId(model));
    memo.set(model, hit);
    return hit;
  };
}

const defaultLookup = createPricingLookup();

/** Find pricing for any provider-specific spelling of a model id. */
export function findModelPricing(model: string): ModelPricing | undefined {
  return defaultLookup(model);
}
