import { FIVE_HOURS, SEVEN_DAYS, activeBlock, eventCost, type UsageEvent } from "@burnrate/core";
import type { StatusSnapshot } from "../../../packages/cli/src/snapshot.js";
import type { WindowInfo } from "./view.js";

/**
 * Keeping plan limits live while you use the Claude Code chat panel.
 *
 * Only Claude Code's terminal status line reports real limit percentages. The chat panel doesn't,
 * but it does write transcripts. So: every real reading (p% used, with $c of local usage in that
 * window) tells us the window's size, limit ≈ c / p. Between readings we add the cost of new usage
 * from the transcripts on top of the last real percentage. Estimates are marked with "~".
 */

export interface Calibration {
  /** Estimated window size in list-price USD, and when the reading it came from was taken. */
  fiveHour?: { limitUsd: number; observedAt: number };
  sevenDay?: { limitUsd: number; observedAt: number };
}

const LENGTH = { fiveHour: FIVE_HOURS, sevenDay: SEVEN_DAYS } as const;
const LABEL = { fiveHour: "Session (5-hour)", sevenDay: "Weekly" } as const;
type Id = keyof typeof LENGTH;

/** List-price cost of events with from <= timestamp < to. Unpriced models count as 0. */
export function costBetween(events: UsageEvent[], from: number, to: number): number {
  let sum = 0;
  for (const e of events) {
    const t = Date.parse(e.timestamp);
    if (t >= from && t < to) sum += eventCost(e) ?? 0;
  }
  return sum;
}

function realWindow(snapshot: StatusSnapshot | undefined, id: Id) {
  const w = id === "fiveHour" ? snapshot?.rateLimits?.five_hour : snapshot?.rateLimits?.seven_day;
  if (w?.used_percentage === undefined || w.resets_at === undefined || !snapshot?.rateLimitsAt)
    return undefined;
  return { percent: w.used_percentage, resetsAt: w.resets_at * 1000, observedAt: snapshot.rateLimitsAt };
}

/**
 * Derive window sizes from the latest real reading. Readings with too little usage to measure
 * (under 2% or under 5 cents) are skipped, and the previous calibration is kept.
 */
export function calibrate(
  snapshot: StatusSnapshot | undefined,
  events: UsageEvent[],
  previous: Calibration = {},
): Calibration {
  const next: Calibration = { ...previous };
  for (const id of ["fiveHour", "sevenDay"] as const) {
    const real = realWindow(snapshot, id);
    if (!real || previous[id]?.observedAt === real.observedAt) continue;
    const windowStart = real.resetsAt - LENGTH[id];
    const spent = costBetween(events, windowStart, real.observedAt + 1);
    if (real.percent >= 2 && spent >= 0.05)
      next[id] = { limitUsd: spent / (real.percent / 100), observedAt: real.observedAt };
  }
  return next;
}

/**
 * Session and weekly windows for right now: the last real reading plus usage since, or (once a window
 * has reset) usage in the new window. Returns only windows we can say something about.
 */
export function liveWindows(
  snapshot: StatusSnapshot | undefined,
  events: UsageEvent[],
  calibration: Calibration,
  now: number,
): WindowInfo[] {
  const out: WindowInfo[] = [];
  for (const id of ["fiveHour", "sevenDay"] as const) {
    const real = realWindow(snapshot, id);
    const limit = calibration[id]?.limitUsd;

    if (real && now < real.resetsAt) {
      const since = costBetween(events, real.observedAt + 1, now + 1);
      if (limit && since > 0) {
        out.push({
          id,
          label: LABEL[id],
          percent: real.percent + (since / limit) * 100,
          estimated: true,
          resetsAt: real.resetsAt,
        });
      } else {
        out.push({ id, label: LABEL[id], percent: real.percent, resetsAt: real.resetsAt });
      }
      continue;
    }
    if (!limit) continue;

    // The window has reset since the last reading: estimate the new one from transcripts alone.
    const previousReset = real?.resetsAt ?? now - LENGTH[id];
    if (id === "fiveHour") {
      const block = activeBlock(
        events.filter((e) => Date.parse(e.timestamp) >= previousReset),
        new Date(now),
      );
      out.push(
        block
          ? {
              id,
              label: LABEL[id],
              percent: (block.totals.costUsd / limit) * 100,
              estimated: true,
              resetsAt: block.end.getTime(),
            }
          : { id, label: LABEL[id], percent: 0, estimated: true },
      );
    } else {
      // Weekly windows roll on a fixed schedule: the next one starts where the last ended.
      let start = previousReset;
      while (start + SEVEN_DAYS <= now) start += SEVEN_DAYS;
      out.push({
        id,
        label: LABEL[id],
        percent: (costBetween(events, start, now + 1) / limit) * 100,
        estimated: true,
        resetsAt: start + SEVEN_DAYS,
      });
    }
  }
  return out;
}
