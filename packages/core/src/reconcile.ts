import { findModelPricing } from "@burnrate/pricing";
import { costFromPricing } from "./cost.js";
import type { ProviderCostRow, ProviderId, ProviderUsageRow } from "./types.js";

/**
 * What BurnRate's pricing table says a provider usage row should cost, or undefined when the model
 * isn't priced (e.g. OpenAI models today). Anthropic 1h cache writes map to the 1h rate; other
 * providers' long-lived cache writes have no equivalent and leave the row unpriced.
 */
export function computedCost(row: ProviderUsageRow): number | undefined {
  const pricing = findModelPricing(row.model);
  if (!pricing) return undefined;
  if (row.provider !== "anthropic" && row.cacheWriteLongTokens > 0) return undefined;
  return costFromPricing(
    {
      inputTokens: row.uncachedInputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      cacheWrite1hTokens: row.provider === "anthropic" ? row.cacheWriteLongTokens : 0,
    },
    pricing,
  ).total;
}

export interface ReconcileRow {
  key: string;
  provider: ProviderId;
  /** What the provider billed. */
  reportedUsd: number;
  /** What BurnRate's pricing table predicts from the provider's own token counts. */
  computedUsd?: number;
  /** reported - computed, when both exist. Positive means you were billed more than list price. */
  differenceUsd?: number;
  /** Token usage rows that couldn't be priced. */
  unpricedRows: number;
}

/**
 * Compare billed cost with list-price cost per day or per model. Differences usually come from
 * discounts, batch pricing, data residency, server tools (web search), or pricing-table drift.
 */
export function reconcile(
  usage: ProviderUsageRow[],
  costs: ProviderCostRow[],
  by: "day" | "model",
): ReconcileRow[] {
  const rows = new Map<string, ReconcileRow>();
  const keyOf = (provider: ProviderId, bucketStart: string, model?: string) =>
    by === "day" ? `${provider}|${bucketStart.slice(0, 10)}` : `${provider}|${normalize(model)}`;
  const normalize = (m?: string) => (m ? (findModelPricing(m)?.id ?? m) : "(other)");
  const get = (provider: ProviderId, key: string) => {
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { key: key.split("|")[1]!, provider, reportedUsd: 0, unpricedRows: 0 }));
    return r;
  };

  for (const c of costs)
    get(c.provider, keyOf(c.provider, c.bucketStart, c.model)).reportedUsd += c.amountUsd;
  for (const u of usage) {
    const r = get(u.provider, keyOf(u.provider, u.bucketStart, u.model));
    const cost = computedCost(u);
    if (cost === undefined) r.unpricedRows++;
    else r.computedUsd = (r.computedUsd ?? 0) + cost;
  }
  for (const r of rows.values())
    if (r.computedUsd !== undefined && r.unpricedRows === 0) r.differenceUsd = r.reportedUsd - r.computedUsd;

  return [...rows.values()].sort((a, b) =>
    by === "day"
      ? a.key.localeCompare(b.key) || a.provider.localeCompare(b.provider)
      : b.reportedUsd - a.reportedUsd,
  );
}
