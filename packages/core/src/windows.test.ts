import { describe, expect, it } from "vitest";
import { groupEvents, sumEvents } from "./aggregate.js";
import type { UsageEvent } from "./types.js";
import {
  FIVE_HOURS,
  HOUR,
  activeBlock,
  blockBurnRate,
  computeBlocks,
  estimateBlockLimit,
  estimateRollingLimit,
  projectFromSamples,
} from "./windows.js";

let n = 0;
/** Haiku 4.5: 1M input = $1, so inputTokens below read directly as micro-dollars. */
const ev = (iso: string, inputTokens = 1_000_000, extra: Partial<UsageEvent> = {}): UsageEvent => ({
  id: `e${n++}`,
  timestamp: iso,
  tool: "claude-code",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  inputTokens,
  outputTokens: 0,
  source: "local-log",
  ...extra,
});

describe("computeBlocks", () => {
  it("floors block start to the hour and closes after five hours", () => {
    const blocks = computeBlocks([
      ev("2026-10-01T09:42:00Z"),
      ev("2026-10-01T13:59:00Z"), // still inside 09:00-14:00
      ev("2026-10-01T14:00:00Z"), // opens a new block
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.start.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(blocks[0]!.end.toISOString()).toBe("2026-10-01T14:00:00.000Z");
    expect(blocks[0]!.totals.requests).toBe(2);
    expect(blocks[1]!.start.toISOString()).toBe("2026-10-01T14:00:00.000Z");
  });

  it("sorts unordered input and skips bad timestamps", () => {
    const blocks = computeBlocks([ev("2026-10-01T12:00:00Z"), ev("not a date"), ev("2026-10-01T10:00:00Z")]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.totals.requests).toBe(2);
  });
});

describe("activeBlock", () => {
  const events = [ev("2026-10-01T09:30:00Z")];
  it("returns the block containing now", () => {
    expect(activeBlock(events, new Date("2026-10-01T12:00:00Z"))).toBeDefined();
  });
  it("returns undefined once the block has ended", () => {
    expect(activeBlock(events, new Date("2026-10-01T14:00:00Z"))).toBeUndefined();
  });
});

describe("burn rate and limit estimate", () => {
  // $2 spent between 10:00 and 11:00, checked at 11:00 -> $2/h. Block ends 15:00.
  const events = [ev("2026-10-01T10:00:00Z"), ev("2026-10-01T10:30:00Z")];
  const now = new Date("2026-10-01T11:00:00Z");
  const block = activeBlock(events, now)!;

  it("computes cost per hour since first activity", () => {
    expect(blockBurnRate(block, now).costPerHour).toBeCloseTo(2, 6);
  });

  it("projects time to a cost limit", () => {
    // $2 used of $5; $3 left at $2/h = 1.5h, before the 15:00 reset.
    const est = estimateBlockLimit(block, { costUsd: 5 }, now)!;
    expect(est.usedPercent).toBeCloseTo(40, 6);
    expect(est.msToLimit).toBeCloseTo(1.5 * HOUR, -3);
    expect(est.resetsAt.toISOString()).toBe("2026-10-01T15:00:00.000Z");
  });

  it("omits msToLimit when the window resets first", () => {
    expect(estimateBlockLimit(block, { costUsd: 100 }, now)!.msToLimit).toBeUndefined();
  });

  it("supports token limits", () => {
    expect(estimateBlockLimit(block, { tokens: 4_000_000 }, now)!.usedPercent).toBeCloseTo(50, 6);
  });

  it("returns undefined with no limit configured", () => {
    expect(estimateBlockLimit(block, {}, now)).toBeUndefined();
  });
});

describe("estimateRollingLimit", () => {
  it("counts only the trailing window and resets when the oldest event ages out", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const events = [ev("2026-09-30T12:00:00Z"), ev("2026-10-02T12:00:00Z"), ev("2026-10-08T11:00:00Z")];
    const est = estimateRollingLimit(events, { costUsd: 4 }, now)!;
    expect(est.usedPercent).toBeCloseTo(50, 6);
    expect(est.resetsAt.toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });
});

describe("projectFromSamples", () => {
  const t0 = Date.parse("2026-10-01T10:00:00Z");
  it("extrapolates linearly to 100%", () => {
    // 20% -> 30% in 30 min: 70% left takes 3.5h.
    const ms = projectFromSamples(
      [
        { at: t0, percent: 20 },
        { at: t0 + 30 * 60_000, percent: 30 },
      ],
      t0 + FIVE_HOURS,
      t0 + 30 * 60_000,
    );
    expect(ms).toBeCloseTo(3.5 * HOUR, -3);
  });
  it("returns undefined when the window resets first or usage is flat", () => {
    const flat = [
      { at: t0, percent: 20 },
      { at: t0 + HOUR, percent: 20 },
    ];
    expect(projectFromSamples(flat, t0 + FIVE_HOURS, t0 + HOUR)).toBeUndefined();
    const slow = [
      { at: t0, percent: 20 },
      { at: t0 + HOUR, percent: 21 },
    ];
    expect(projectFromSamples(slow, t0 + FIVE_HOURS, t0 + HOUR)).toBeUndefined();
  });
});

describe("aggregate", () => {
  it("totals cost and tracks unpriced requests", () => {
    const t = sumEvents([
      ev("2026-10-01T10:00:00Z"),
      ev("2026-10-01T10:00:00Z", 10, { model: "mystery-model" }),
    ]);
    expect(t.requests).toBe(2);
    expect(t.costUsd).toBeCloseTo(1, 6);
    expect(t.unpricedRequests).toBe(1);
  });

  it("groups by model, most expensive first", () => {
    const rows = groupEvents(
      [ev("2026-10-01T10:00:00Z", 1), ev("2026-10-01T10:00:00Z", 1, { model: "claude-opus-5-5" })],
      "model",
    );
    expect(rows.map((r) => r.key)).toEqual(["claude-opus-5-5", "claude-haiku-4-5"]);
  });

  it("groups by local week starting Monday", () => {
    // Use local-time constructors so the test holds in any timezone.
    const sun = new Date(2026, 9, 4, 12).toISOString(); // Sunday Oct 4
    const mon = new Date(2026, 9, 5, 12).toISOString(); // Monday Oct 5
    const rows = groupEvents([ev(sun), ev(mon)], "week");
    expect(rows.map((r) => r.key)).toEqual(["2026-09-28", "2026-10-05"]);
  });
});
