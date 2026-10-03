import { useEffect, useState } from "react";
import { formatMoney, formatTokens, USD, type CurrencyConfig } from "@burnrate/core/browser";

export { formatTokens };

export const money = (usd: number, currency: CurrencyConfig = USD) => formatMoney(usd, currency);

/** More precision for amounts under one unit, e.g. $0.0171 per request. */
export const moneyPrecise = (usd: number, currency: CurrencyConfig = USD) => {
  const v = usd * currency.rateFromUsd;
  if (v !== 0 && Math.abs(v) < 1) return `${currency.symbol}${v.toFixed(4)}`;
  return formatMoney(usd, currency);
};

export const integer = (n: number) => n.toLocaleString("en-US");

const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DATE_Y = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** "2026-10-03" (local) -> Date at local midnight. */
export const parseDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
export const shortDate = (d: Date) => DATE.format(d);
export const longDate = (d: Date) => DATE_Y.format(d);

export type RangeId = "7d" | "30d" | "90d" | "all";
export const RANGES: Array<{ id: RangeId; label: string; days?: number }> = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "all", label: "All" },
];

/** Start of the range: local midnight, so "7 days" means today plus the six days before. */
export function rangeStart(id: RangeId, now = new Date()): Date | undefined {
  const days = RANGES.find((r) => r.id === id)?.days;
  if (!days) return undefined;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
}

/** Resolved values of the CSS color tokens; Recharts needs real colors, not var(). Re-reads on theme change. */
export function useTokens<K extends string>(names: readonly K[]): Record<K, string> {
  const read = () => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(`--${n}`).trim()])) as Record<
      K,
      string
    >;
  };
  const [tokens, setTokens] = useState(read);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTokens(read());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return tokens;
}

/** Series id -> CSS token. Colors follow the entity's slot, never its rank in a filtered view. */
export function seriesToken(index: number, id: string): string {
  return id === "other" ? "series-other" : `series-${index + 1}`;
}
