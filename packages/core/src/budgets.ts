import { dayKey, monthKey, sumEvents, weekKey } from "./aggregate.js";
import type { UsageEvent } from "./types.js";

export type BudgetPeriod = "daily" | "weekly" | "monthly";
export const BUDGET_PERIODS: readonly BudgetPeriod[] = ["daily", "weekly", "monthly"];

/** Spending caps in USD per calendar period (local time; weeks start Monday). */
export type Budgets = Partial<Record<BudgetPeriod, number>>;

export interface BudgetStatus {
  period: BudgetPeriod;
  limitUsd: number;
  spentUsd: number;
  percent: number;
  /** Spend at the current pace by the end of the period. */
  projectedUsd: number;
  /** "ok" < warn threshold <= "warn" < 100% <= "over". "pace" = under now, but on pace to exceed. */
  state: "ok" | "warn" | "pace" | "over";
  periodStart: Date;
  periodEnd: Date;
}

function periodBounds(period: BudgetPeriod, now: Date): [Date, Date] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "daily")
    return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)];
  if (period === "weekly") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)];
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return [monthStart, new Date(now.getFullYear(), now.getMonth() + 1, 1)];
}

const KEY = { daily: dayKey, weekly: weekKey, monthly: monthKey } as const;

/** Where each configured budget stands right now. */
export function budgetStatus(
  events: UsageEvent[],
  budgets: Budgets,
  now = new Date(),
  warnPercent = 80,
): BudgetStatus[] {
  const out: BudgetStatus[] = [];
  for (const period of BUDGET_PERIODS) {
    const limitUsd = budgets[period];
    if (!limitUsd || limitUsd <= 0) continue;
    const key = KEY[period](now);
    const spentUsd = sumEvents(events.filter((e) => KEY[period](new Date(e.timestamp)) === key)).costUsd;
    const [periodStart, periodEnd] = periodBounds(period, now);
    const elapsed = Math.max(now.getTime() - periodStart.getTime(), 1);
    const length = periodEnd.getTime() - periodStart.getTime();
    // Don't extrapolate from the first hour of a period: one request would project a huge number.
    const projectedUsd = elapsed < 3_600_000 ? spentUsd : (spentUsd / elapsed) * length;
    const percent = (spentUsd / limitUsd) * 100;
    const state =
      percent >= 100 ? "over" : percent >= warnPercent ? "warn" : projectedUsd > limitUsd ? "pace" : "ok";
    out.push({ period, limitUsd, spentUsd, percent, projectedUsd, state, periodStart, periodEnd });
  }
  return out;
}
