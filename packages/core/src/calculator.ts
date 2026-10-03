import { createPricingLookup, pricingTable, type ModelPricing, type PricingTable } from "@burnrate/pricing";
import { costFromPricing, type CostBreakdown } from "./cost.js";
import type { UsageEvent } from "./types.js";

/** A typical request, plus how many of them you make. Used to compare models side by side. */
export interface Workload {
  /** Uncached input tokens per request. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  /** 5-minute cache writes per request. */
  cacheWriteTokens?: number;
  cacheWrite1hTokens?: number;
  requestsPerDay: number;
  /** Days per month for the monthly figure. Default 30. */
  daysPerMonth?: number;
}

export interface ModelQuote {
  model: ModelPricing;
  perRequest: CostBreakdown;
  perDay: number;
  perMonth: number;
}

/** Price one workload on every model in the table (or a subset), cheapest first. */
export function compareModels(
  w: Workload,
  opts: { models?: string[]; includeRetired?: boolean; table?: PricingTable } = {},
): ModelQuote[] {
  const table = opts.table ?? pricingTable;
  const wanted = opts.models ? new Set(opts.models) : undefined;
  const days = w.daysPerMonth ?? 30;
  return table.models
    .filter((m) => (wanted ? wanted.has(m.id) : opts.includeRetired || m.status !== "retired"))
    .map((model) => {
      const perRequest = costFromPricing(w, model);
      const perDay = perRequest.total * w.requestsPerDay;
      return { model, perRequest, perDay, perMonth: perDay * days };
    })
    .sort((a, b) => a.perMonth - b.perMonth || a.model.id.localeCompare(b.model.id));
}

export interface RepriceResult {
  /** What the events cost on the models actually used (priced events only). */
  actualUsd: number;
  /** What the same token counts would cost on the target model. */
  repricedUsd: number;
  /** Events included in the comparison. */
  requests: number;
  /** Events skipped because their original model has no pricing. */
  skippedUnpriced: number;
  byModel: Array<{ model: string; requests: number; actualUsd: number; repricedUsd: number }>;
}

/**
 * "What if I had used model X?" Re-prices historical events at another model's rates.
 * Token counts are kept as-is. Different tokenizers count the same text differently,
 * so treat the result as an estimate (see the caveat shown in the UI).
 */
export function repriceEvents(
  events: Iterable<UsageEvent>,
  targetModel: string,
  opts: { onlyModel?: string; table?: PricingTable } = {},
): RepriceResult | undefined {
  const lookup = createPricingLookup(opts.table ?? pricingTable);
  const target = lookup(targetModel);
  if (!target) return undefined;
  const onlyId = opts.onlyModel ? (lookup(opts.onlyModel)?.id ?? opts.onlyModel) : undefined;
  const rows = new Map<string, { model: string; requests: number; actualUsd: number; repricedUsd: number }>();
  const result: RepriceResult = {
    actualUsd: 0,
    repricedUsd: 0,
    requests: 0,
    skippedUnpriced: 0,
    byModel: [],
  };

  for (const e of events) {
    const original = lookup(e.model);
    if (!original) {
      result.skippedUnpriced++;
      continue;
    }
    if (onlyId && original.id !== onlyId) continue;
    const actual = costFromPricing(e, original).total;
    // Fast mode only exists on some models; re-price at standard speed when the target lacks it.
    const repriced = costFromPricing(target.fastModePrices ? e : { ...e, speed: "standard" }, target).total;
    result.actualUsd += actual;
    result.repricedUsd += repriced;
    result.requests++;
    let row = rows.get(original.id);
    if (!row)
      rows.set(original.id, (row = { model: original.id, requests: 0, actualUsd: 0, repricedUsd: 0 }));
    row.requests++;
    row.actualUsd += actual;
    row.repricedUsd += repriced;
  }
  result.byModel = [...rows.values()].sort((a, b) => b.actualUsd - a.actualUsd);
  return result;
}
