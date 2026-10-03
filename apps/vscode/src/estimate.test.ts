import { describe, expect, it } from "vitest";
import type { UsageEvent } from "@burnrate/core";
import type { StatusSnapshot } from "../../../packages/cli/src/snapshot.js";
import { calibrate, costBetween, liveWindows } from "./estimate.js";

const H = 3_600_000;
const T = Date.parse("2026-10-03T10:00:00Z"); // when Claude Code last reported real limits
let n = 0;
/** Haiku 4.5: 1M input tokens = exactly $1. */
const usd = (iso: string, dollars = 1): UsageEvent => ({
  id: `e${n++}`,
  timestamp: iso,
  tool: "claude-code",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  inputTokens: dollars * 1_000_000,
  outputTokens: 0,
  source: "local-log",
});

const snapshot: StatusSnapshot = {
  version: 1,
  updatedAt: T,
  rateLimitsAt: T,
  rateLimits: {
    // Session window 07:00-12:00, 20% used at 10:00.
    five_hour: { used_percentage: 20, resets_at: (T + 2 * H) / 1000 },
    // Weekly window started 4 days before T, 10% used.
    seven_day: { used_percentage: 10, resets_at: (T + 3 * 24 * H) / 1000 },
  },
  recentSessions: [],
};

// $2 in the session window before the reading; nothing else earlier this week.
const before = [usd("2026-10-03T08:00:00Z"), usd("2026-10-03T09:00:00Z")];

describe("calibrate", () => {
  it("derives window sizes from a real reading (hand-checked)", () => {
    const c = calibrate(snapshot, before);
    // $2 = 20% of the session window -> $10; $2 = 10% of the weekly window -> $20.
    expect(c.fiveHour).toEqual({ limitUsd: 10, observedAt: T });
    expect(c.sevenDay).toEqual({ limitUsd: 20, observedAt: T });
  });

  it("keeps the previous calibration when a reading is too small to measure", () => {
    const tiny: StatusSnapshot = {
      ...snapshot,
      rateLimitsAt: T + 1,
      rateLimits: { five_hour: { used_percentage: 1, resets_at: (T + 2 * H) / 1000 } },
    };
    const prev = { fiveHour: { limitUsd: 10, observedAt: T } };
    expect(calibrate(tiny, before, prev)).toEqual(prev);
  });
});

describe("liveWindows", () => {
  const cal = calibrate(snapshot, before);

  it("adds chat-panel usage since the reading on top of the real percentage", () => {
    const events = [...before, usd("2026-10-03T10:30:00Z")]; // +$1 after the reading
    const [session, weekly] = liveWindows(snapshot, events, cal, T + H);
    // 20% + $1/$10 = 30%; 10% + $1/$20 = 15%
    expect(session).toMatchObject({ id: "fiveHour", estimated: true, resetsAt: T + 2 * H });
    expect(session!.percent).toBeCloseTo(30, 10);
    expect(weekly!.percent).toBeCloseTo(15, 10);
  });

  it("shows the real reading unchanged when nothing happened since", () => {
    const [session] = liveWindows(snapshot, before, cal, T + H);
    expect(session).toEqual({ id: "fiveHour", label: "Session (5-hour)", percent: 20, resetsAt: T + 2 * H });
  });

  it("estimates a fresh session window after the old one reset", () => {
    const now = T + 3 * H; // 13:00, after the 12:00 reset
    const events = [...before, usd("2026-10-03T12:30:00Z", 2)];
    const [session] = liveWindows(snapshot, events, cal, now);
    // New block starts 12:00 (hour of first request): $2 / $10 = 20%, resets 17:00.
    expect(session!.percent).toBeCloseTo(20, 10);
    expect(session!.resetsAt).toBe(Date.parse("2026-10-03T17:00:00Z"));
    expect(liveWindows(snapshot, before, cal, now)[0]).toMatchObject({ percent: 0, estimated: true });
  });

  it("says nothing about windows it has no reading or calibration for", () => {
    expect(liveWindows(undefined, before, {}, T)).toEqual([]);
  });
});

describe("costBetween", () => {
  it("is half-open: includes from, excludes to", () => {
    const e = [usd("2026-10-03T10:00:00Z")];
    expect(costBetween(e, T, T + 1)).toBe(1);
    expect(costBetween(e, T - 1, T)).toBe(0);
  });
});
