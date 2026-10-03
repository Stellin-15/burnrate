import type { ProviderCostRow, ProviderId, ProviderUsageRow } from "@burnrate/core";
import { fetchAnthropicCosts, fetchAnthropicUsage } from "@burnrate/adapter-anthropic-api";
import { fetchOpenAICosts, fetchOpenAIUsage } from "@burnrate/adapter-openai-api";
import type { BurnrateStore } from "@burnrate/store";

export interface SyncResult {
  provider: ProviderId;
  from: Date;
  to: Date;
  usageRows: number;
  costRows: number;
  reportedUsd: number;
}

type Fetchers = {
  usage: (o: { apiKey: string; from: Date; to: Date; fetch?: typeof fetch }) => Promise<ProviderUsageRow[]>;
  costs: (o: { apiKey: string; from: Date; to: Date; fetch?: typeof fetch }) => Promise<ProviderCostRow[]>;
};

const FETCHERS: Record<ProviderId, Fetchers> = {
  anthropic: { usage: fetchAnthropicUsage, costs: fetchAnthropicCosts },
  openai: { usage: fetchOpenAIUsage, costs: fetchOpenAICosts },
};

/** UTC midnight `days - 1` days ago, so "30 days" means today plus the 29 before (provider buckets are UTC days). */
export function syncWindowStart(days: number, now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

/**
 * Pull `days` of usage and billed cost for one provider into the store. Re-running is safe:
 * usage upserts by bucket, and the cost window is replaced so revised days don't double count.
 */
export async function syncProvider(
  provider: ProviderId,
  apiKey: string,
  store: BurnrateStore,
  opts: { days?: number; now?: Date; fetch?: typeof fetch } = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const from = syncWindowStart(opts.days ?? 30, now);
  const to = now;
  const f = FETCHERS[provider];
  try {
    const [usage, costs] = await Promise.all([
      f.usage({ apiKey, from, to, fetch: opts.fetch }),
      f.costs({ apiKey, from, to, fetch: opts.fetch }),
    ]);
    store.upsertProviderUsage(usage);
    store.replaceProviderCosts(provider, from.toISOString(), to.toISOString(), costs);
    store.setSyncState(provider, now.getTime());
    return {
      provider,
      from,
      to,
      usageRows: usage.length,
      costRows: costs.length,
      reportedUsd: costs.reduce((s, c) => s + c.amountUsd, 0),
    };
  } catch (err) {
    store.setSyncState(provider, now.getTime(), (err as Error).message);
    throw err;
  }
}
