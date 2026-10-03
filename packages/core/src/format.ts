export interface CurrencyConfig {
  /** ISO code shown in reports, e.g. "USD", "EUR". */
  code: string;
  /** Symbol prefix, e.g. "$", "€". */
  symbol: string;
  /** Multiply USD amounts by this to convert. You set it; BurnRate never fetches exchange rates. */
  rateFromUsd: number;
}

export const USD: CurrencyConfig = { code: "USD", symbol: "$", rateFromUsd: 1 };

export function formatMoney(usd: number, currency: CurrencyConfig = USD): string {
  const v = usd * currency.rateFromUsd;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 100_000) return `${sign}${currency.symbol}${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1000) return `${sign}${currency.symbol}${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (abs > 0 && abs < 0.01) return `${sign}${currency.symbol}<0.01`;
  return `${sign}${currency.symbol}${abs.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** Compact duration: "3d4h", "1h12m", "42m", "<1m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "<1m";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h ? `${d}d${h}h` : `${d}d`;
  if (h > 0) return m ? `${h}h${String(m).padStart(2, "0")}m` : `${h}h`;
  return `${m}m`;
}

export function formatPercent(p: number): string {
  if (!Number.isFinite(p)) return "?%";
  return `${Math.round(p)}%`;
}

/** Strip ANSI escapes to measure visible width. */
export function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").length;
}
