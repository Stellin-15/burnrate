import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@burnrate/core";
import type { StatusSnapshot } from "../../../packages/cli/src/snapshot.js";
import type { LocalSummary } from "../../../packages/cli/src/summary.js";
import { buildView, collectWindows, dashboardLaunch } from "./view.js";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const sec = (ms: number) => Math.floor(ms / 1000);
const H = 3_600_000;

const snapshot = (five = 39, seven = 37): StatusSnapshot => ({
  version: 1,
  updatedAt: NOW - 60_000,
  rateLimitsAt: NOW - 60_000,
  rateLimits: {
    five_hour: { used_percentage: five, resets_at: sec(NOW + 2 * H + 16 * 60_000) },
    seven_day: { used_percentage: seven, resets_at: sec(NOW + 100 * H) },
  },
  recentSessions: [],
});

const local: LocalSummary = {
  computedAt: NOW,
  day: "2026-10-03",
  todayCostUsd: 46.12,
  block: { start: NOW - H, end: NOW + 4 * H, costUsd: 12.5, totalTokens: 1, burnRatePerHour: 6.25 },
  sevenDay: { costUsd: 239, totalTokens: 1 },
};

describe("buildView", () => {
  it("shows real plan limits and today's cost, like the terminal meter", () => {
    const v = buildView(snapshot(), local, DEFAULT_CONFIG, { now: NOW });
    expect(v.text).toBe("$(pulse) 5h 39% ↻ 2h16m │ 7d 37% │ $46.12 today");
    expect(v.level).toBe("normal");
    expect(v.tooltip).toContain("| **5-hour limit** | 39% used, resets in 2h16m |");
    expect(v.tooltip).toContain("| **Burn rate** | $6.25/h |");
    expect(v.tooltip).toContain("Plan limits from Claude Code");
    expect(v.tooltip).toContain("command:burnrate.openDashboard");
  });

  it("turns amber and red at the configured thresholds", () => {
    expect(buildView(snapshot(70), local, DEFAULT_CONFIG, { now: NOW }).level).toBe("warning");
    expect(buildView(snapshot(20, 90), local, DEFAULT_CONFIG, { now: NOW }).level).toBe("error");
  });

  it("drops limits whose window already reset, falling back to the local block", () => {
    const stale: StatusSnapshot = {
      ...snapshot(),
      rateLimits: { five_hour: { used_percentage: 99, resets_at: sec(NOW - H) } },
    };
    const v = buildView(stale, local, DEFAULT_CONFIG, { now: NOW });
    expect(v.text).toBe("$(pulse) 5h $12.50 ↻ 4h │ $46.12 today");
    expect(v.level).toBe("normal");
    expect(v.tooltip).toContain("The chat panel doesn't report them");
  });

  it("marks estimates from configured limits with ~", () => {
    const est = { ...local, block: { ...local.block!, estimate: { usedPercent: 45 } } };
    const v = buildView(undefined, est, DEFAULT_CONFIG, { now: NOW });
    expect(v.text).toContain("5h ~45%");
    expect(v.tooltip).toContain("`~` marks estimates");
  });

  it("can hide today's cost and handles no data at all", () => {
    expect(
      buildView(snapshot(), local, DEFAULT_CONFIG, { now: NOW, showTodayCost: false }).text,
    ).not.toContain("today");
    const empty = buildView(undefined, undefined, DEFAULT_CONFIG, { now: NOW });
    expect(empty.text).toBe("$(pulse) BurnRate");
    expect(empty.tooltip).toContain("No Claude Code usage found yet.");
  });

  it("orders windows 5h, 7d, spend", () => {
    const s = snapshot();
    s.rateLimits!.spend_limit = { used_percentage: 10, resets_at: sec(NOW + H) };
    expect(collectWindows(s, undefined, NOW).map((w) => w.id)).toEqual([
      "fiveHour",
      "sevenDay",
      "spendLimit",
    ]);
  });
});

describe("dashboardLaunch", () => {
  it("reuses the node and script that init wrote into Claude Code's settings", () => {
    expect(
      dashboardLaunch('"C:/Program Files/nodejs/node.exe" D:/burnrate/packages/cli/dist/cli.js statusline'),
    ).toEqual({
      shellPath: "C:/Program Files/nodejs/node.exe",
      shellArgs: ["D:/burnrate/packages/cli/dist/cli.js", "dashboard"],
    });
    expect(dashboardLaunch("/usr/bin/node /opt/burnrate/cli.js statusline")?.shellArgs[1]).toBe("dashboard");
  });

  it("ignores status lines that aren't BurnRate's", () => {
    expect(dashboardLaunch("~/my-statusline.sh")).toBeUndefined();
    expect(dashboardLaunch("node /x/other-tool.js statusline")).toBeUndefined();
    expect(dashboardLaunch(undefined)).toBeUndefined();
  });
});
