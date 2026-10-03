import { addToTotals, emptyTotals, type UsageTotals } from "./aggregate.js";
import type { UsageEvent } from "./types.js";

export const HOUR = 60 * 60 * 1000;
export const FIVE_HOURS = 5 * HOUR;
export const SEVEN_DAYS = 7 * 24 * HOUR;

export interface UsageBlock {
  /** Block start, floored to the hour of its first request. */
  start: Date;
  /** start + window length. */
  end: Date;
  firstActivity: Date;
  lastActivity: Date;
  totals: UsageTotals;
}

/**
 * Split events into rolling usage blocks the way subscription session windows behave:
 * a block opens at the hour of the first request and lasts `windowMs`; the next request
 * after it closes opens a new block. Only an approximation of the provider's real window.
 */
export function computeBlocks(events: Iterable<UsageEvent>, windowMs = FIVE_HOURS): UsageBlock[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const blocks: UsageBlock[] = [];
  let current: UsageBlock | undefined;
  for (const e of sorted) {
    const t = new Date(e.timestamp);
    if (Number.isNaN(t.getTime())) continue;
    if (!current || t >= current.end) {
      const start = new Date(t);
      start.setMinutes(0, 0, 0);
      current = { start, end: new Date(start.getTime() + windowMs), firstActivity: t, lastActivity: t, totals: emptyTotals() };
      blocks.push(current);
    }
    current.lastActivity = t;
    addToTotals(current.totals, e);
  }
  return blocks;
}

/** The block that contains `now`, if any. */
export function activeBlock(events: Iterable<UsageEvent>, now = new Date(), windowMs = FIVE_HOURS): UsageBlock | undefined {
  const blocks = computeBlocks(events, windowMs);
  const last = blocks.at(-1);
  return last && now >= last.start && now < last.end ? last : undefined;
}

/** Totals for events in the trailing window ending at `now`. */
export function rollingTotals(events: Iterable<UsageEvent>, now = new Date(), windowMs = SEVEN_DAYS): UsageTotals {
  const from = now.getTime() - windowMs;
  const t = emptyTotals();
  for (const e of events) {
    const ts = Date.parse(e.timestamp);
    if (ts >= from && ts <= now.getTime()) addToTotals(t, e);
  }
  return t;
}

export interface BurnRate {
  costPerHour: number;
  tokensPerMinute: number;
}

/** Average spend rate since the block's first request (at least one minute, to avoid spikes). */
export function blockBurnRate(block: UsageBlock, now = new Date()): BurnRate {
  const elapsed = Math.max(now.getTime() - block.firstActivity.getTime(), 60_000);
  return {
    costPerHour: (block.totals.costUsd / elapsed) * HOUR,
    tokensPerMinute: (block.totals.totalTokens / elapsed) * 60_000,
  };
}

/** A user-configured limit for a window. Either unit works; cost is usually more stable across models. */
export interface WindowLimit {
  costUsd?: number;
  tokens?: number;
}

export interface LimitEstimate {
  /** 0-100+, percent of the configured limit used. */
  usedPercent: number;
  /** Milliseconds until the limit is hit at the current burn rate, if it would be hit before `resetsAt`. */
  msToLimit?: number;
  resetsAt: Date;
}

/** Estimate how much of a configured limit the block has used, and when it would run out. */
export function estimateBlockLimit(block: UsageBlock, limit: WindowLimit, now = new Date()): LimitEstimate | undefined {
  const used = limit.costUsd ? block.totals.costUsd : block.totals.totalTokens;
  const cap = limit.costUsd ?? limit.tokens;
  if (!cap || cap <= 0) return undefined;
  const usedPercent = (used / cap) * 100;
  const rate = blockBurnRate(block, now);
  const perMs = limit.costUsd ? rate.costPerHour / HOUR : rate.tokensPerMinute / 60_000;
  const msLeftInWindow = block.end.getTime() - now.getTime();
  let msToLimit: number | undefined;
  if (used >= cap) msToLimit = 0;
  else if (perMs > 0) {
    const ms = (cap - used) / perMs;
    if (ms < msLeftInWindow) msToLimit = ms;
  }
  return { usedPercent, msToLimit, resetsAt: block.end };
}

/** Same as estimateBlockLimit but for a trailing window (e.g. 7 days). */
export function estimateRollingLimit(
  events: UsageEvent[],
  limit: WindowLimit,
  now = new Date(),
  windowMs = SEVEN_DAYS,
): LimitEstimate | undefined {
  const cap = limit.costUsd ?? limit.tokens;
  if (!cap || cap <= 0) return undefined;
  const totals = rollingTotals(events, now, windowMs);
  const used = limit.costUsd ? totals.costUsd : totals.totalTokens;
  // The oldest in-window request is the next one to fall out, which is when usage first drops.
  const from = now.getTime() - windowMs;
  let oldest = Infinity;
  for (const e of events) {
    const ts = Date.parse(e.timestamp);
    if (ts >= from && ts <= now.getTime() && ts < oldest) oldest = ts;
  }
  const resetsAt = new Date(Number.isFinite(oldest) ? oldest + windowMs : now.getTime() + windowMs);
  return { usedPercent: (used / cap) * 100, resetsAt, msToLimit: used >= cap ? 0 : undefined };
}

/**
 * Project when an officially-reported percentage will reach 100, from two samples taken in the same window.
 * Returns undefined when usage isn't growing or the limit won't be hit before reset.
 */
export function projectFromSamples(
  samples: Array<{ at: number; percent: number }>,
  resetsAtMs: number,
  now = Date.now(),
): number | undefined {
  if (samples.length < 2) return undefined;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const dt = last.at - first.at;
  const dp = last.percent - first.percent;
  if (dt < 60_000 || dp <= 0) return undefined;
  if (last.percent >= 100) return 0;
  const msToLimit = ((100 - last.percent) / dp) * dt - (now - last.at);
  if (msToLimit <= 0) return 0;
  return now + msToLimit < resetsAtMs ? msToLimit : undefined;
}
