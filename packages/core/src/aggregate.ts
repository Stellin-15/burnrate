import { eventCost, totalTokens } from "./cost.js";
import type { UsageEvent } from "./types.js";

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  /** Requests whose model had no pricing entry (their cost is not in costUsd). */
  unpricedRequests: number;
  /** Distinct model ids seen. */
  models: string[];
}

export function emptyTotals(): UsageTotals {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    unpricedRequests: 0,
    models: [],
  };
}

export function addToTotals(t: UsageTotals, e: UsageEvent): UsageTotals {
  t.requests++;
  t.inputTokens += e.inputTokens;
  t.outputTokens += e.outputTokens;
  t.cacheReadTokens += e.cacheReadTokens ?? 0;
  t.cacheWriteTokens += (e.cacheWriteTokens ?? 0) + (e.cacheWrite1hTokens ?? 0);
  t.totalTokens += totalTokens(e);
  const cost = eventCost(e);
  if (cost === undefined) t.unpricedRequests++;
  else t.costUsd += cost;
  if (!t.models.includes(e.model)) t.models.push(e.model);
  return t;
}

export function sumEvents(events: Iterable<UsageEvent>): UsageTotals {
  const t = emptyTotals();
  for (const e of events) addToTotals(t, e);
  return t;
}

export type GroupBy = "day" | "week" | "month" | "model" | "project" | "session" | "tool";

const pad = (n: number) => String(n).padStart(2, "0");

/** Local-time calendar day, YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local-time week, keyed by its Monday (YYYY-MM-DD). */
export function weekKey(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return dayKey(monday);
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function groupKey(e: UsageEvent, by: GroupBy): string {
  switch (by) {
    case "day":
      return dayKey(new Date(e.timestamp));
    case "week":
      return weekKey(new Date(e.timestamp));
    case "month":
      return monthKey(new Date(e.timestamp));
    case "model":
      return e.model;
    case "project":
      return e.project ?? "(unknown)";
    case "session":
      return e.sessionId ?? "(unknown)";
    case "tool":
      return e.tool;
  }
}

/** Group events and total each group. Time groups sort ascending; others sort by cost, highest first. */
export function groupEvents(events: Iterable<UsageEvent>, by: GroupBy): Array<{ key: string; totals: UsageTotals }> {
  const groups = new Map<string, UsageTotals>();
  for (const e of events) {
    const key = groupKey(e, by);
    let t = groups.get(key);
    if (!t) groups.set(key, (t = emptyTotals()));
    addToTotals(t, e);
  }
  const rows = [...groups].map(([key, totals]) => ({ key, totals }));
  const timeBased = by === "day" || by === "week" || by === "month";
  return rows.sort((a, b) =>
    timeBased ? a.key.localeCompare(b.key) : b.totals.costUsd - a.totals.costUsd || b.totals.totalTokens - a.totals.totalTokens,
  );
}
