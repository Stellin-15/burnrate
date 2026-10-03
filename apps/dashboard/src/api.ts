import type { CurrencyConfig, RepriceResult } from "@burnrate/core/browser";
import type { PricingTable } from "@burnrate/pricing";

/** Response shapes of the CLI's local API (packages/cli/src/server.ts). */
export interface Totals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  unpricedRequests: number;
  models: string[];
}
export interface Row extends Totals {
  key: string;
  label: string;
}
export interface DailyRow {
  date: string;
  costUsd: number;
  requests: number;
  byModel: Record<string, number>;
}
export interface Budget {
  period: "daily" | "weekly" | "monthly";
  limitUsd: number;
  spentUsd: number;
  percent: number;
  projectedUsd: number;
  state: "ok" | "warn" | "pace" | "over";
  periodStart: string;
  periodEnd: string;
}
export interface Usage {
  range: { from?: string; to?: string };
  totals: Totals;
  cacheSavingsUsd: number;
  series: Array<{ id: string; label: string }>;
  daily: DailyRow[];
  models: Row[];
  projects: Row[];
  sessions: Array<Row & { startedAt?: string }>;
  budgets: Budget[];
  unpricedModels: string[];
}
export interface Meta {
  version: string;
  currency: CurrencyConfig;
  budgets: Partial<Record<Budget["period"], number>>;
  pricingUpdatedAt: string;
  firstEventAt?: string;
  lastEventAt?: string;
  eventCount: number;
  projects: Array<{ id: string; label: string }>;
  models: Array<{ id: string; label: string }>;
}

/**
 * The token arrives in the URL fragment (never sent to the server or in Referer).
 * Keep it for this tab only, then strip it from the address bar.
 */
export function readToken(): string | undefined {
  const match = /(?:^|[#&])token=([\w-]+)/.exec(location.hash);
  try {
    if (match) {
      sessionStorage.setItem("burnrate-token", match[1]!);
      history.replaceState(null, "", location.pathname + location.search);
      return match[1];
    }
    return sessionStorage.getItem("burnrate-token") ?? undefined;
  } catch {
    return match?.[1];
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createApi(token: string) {
  const get = async <T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> => {
    const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    const res = await fetch(`./api/${path}${qs.size ? `?${qs}` : ""}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError((body as { error?: string }).error ?? res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  };
  return {
    meta: () => get<Meta>("meta"),
    usage: (q: Query) => get<Usage>("usage", q),
    pricing: () => get<PricingTable>("pricing"),
    spend: (q: Query) => get<Spend>("spend", q),
    limits: () => get<Limits>("limits"),
    whatIf: (q: Query & { target: string; only?: string }) => get<RepriceResult>("whatif", q),
    /** Fetch with the auth header, then hand the file to the browser's download. */
    async download(q: Query & { view: string; format: "csv" | "json" }) {
      const qs = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
      const res = await fetch(`./api/export?${qs}`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new ApiError("Export failed", res.status);
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "burnrate-export";
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
export type Api = ReturnType<typeof createApi>;

export type Query = {
  from?: string;
  to?: string;
  project?: string;
  model?: string;
};

export interface ReconcileRow {
  key: string;
  provider: "anthropic" | "openai";
  reportedUsd: number;
  computedUsd?: number;
  differenceUsd?: number;
  unpricedRows: number;
}
export interface Spend {
  available: boolean;
  providers?: string[];
  daily?: Array<{ date: string; byProvider: Record<string, number> }>;
  byDay?: ReconcileRow[];
  byModel?: ReconcileRow[];
  totalUsd?: number;
  syncState?: Array<{ provider: string; lastSyncedAt: number; lastError?: string }>;
}
export interface Limits {
  windows: Array<{ id: "fiveHour" | "sevenDay" | "spendLimit"; usedPercent: number; resetsAt: string }>;
  observedAt?: string;
}
