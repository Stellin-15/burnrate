import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type BurnrateConfig, type UsageEvent } from "@burnrate/core";
import { parseStatuslineInput } from "@burnrate/adapter-claude-code";
import { installStatusLine, uninstallStatusLine, type StatusLineSetting } from "./claude-settings.js";
import { buildStatusModel, demoModel, modelLabel } from "./commands/statusline.js";
import { buildReport, filterEvents, mergeTotals, parseDateArg, projectName } from "./commands/report.js";
import { renderStatusLine } from "./render.js";
import { computeSummary, recordSample, type SampleState } from "./summary.js";
import { renderTable, toCsv } from "./table.js";
import { updateSnapshot } from "./snapshot.js";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const fixture = (name: string) =>
  readFileSync(new URL(`../../adapters/claude-code/fixtures/${name}`, import.meta.url), "utf8");
const cfg = (over: Partial<BurnrateConfig> = {}): BurnrateConfig => ({
  ...structuredClone(DEFAULT_CONFIG),
  ...over,
});
const allWidgets = cfg().widgets.concat(["blockCost", "burnRate", "cache"]);

describe("renderStatusLine themes", () => {
  it.each(["default", "minimal", "plain"] as const)("%s (no color)", (theme) => {
    const line = renderStatusLine(demoModel(NOW), {
      config: cfg({ theme, widgets: allWidgets }),
      color: false,
      now: NOW,
    });
    expect(line).toMatchSnapshot();
  });

  it("default theme with color", () => {
    const line = renderStatusLine(demoModel(NOW), { config: cfg(), color: true, now: NOW });
    expect(line).toMatchSnapshot();
  });

  it("plain theme never emits escape codes", () => {
    const line = renderStatusLine(demoModel(NOW), { config: cfg({ theme: "plain" }), color: true, now: NOW });
    expect(line.includes("\x1b")).toBe(false);
  });

  it("drops trailing widgets to fit COLUMNS", () => {
    const line = renderStatusLine(demoModel(NOW), { config: cfg(), color: false, columns: 40, now: NOW });
    expect(line.length).toBeLessThanOrEqual(40);
    expect(line.startsWith("Opus 5.5")).toBe(true);
  });

  it("skips widgets with no data", () => {
    expect(renderStatusLine({ model: "Haiku 4.5" }, { config: cfg(), color: false })).toBe("Haiku 4.5");
  });

  it("marks estimates with ~ and colors by threshold", () => {
    const line = renderStatusLine(
      { fiveHour: { percent: 90, estimated: true } },
      { config: cfg({ theme: "minimal", widgets: ["fiveHour"] }), color: false },
    );
    expect(line).toBe("5h ~90%");
  });
});

describe("buildStatusModel", () => {
  const pro = parseStatuslineInput(fixture("statusline-pro.json"));

  it("prefers Claude Code's real rate limits", () => {
    const m = buildStatusModel(pro, undefined, {}, NOW);
    expect(m.model).toBe("Opus 5.5");
    expect(m.fiveHour).toEqual({ percent: 72.4, resetsAt: 1790859600_000, msToLimit: undefined });
    expect(m.sevenDay?.percent).toBe(41.2);
    expect(m.contextPercent).toBe(31);
    expect(m.sessionCostUsd).toBe(1.2345);
    expect(m.cacheHitRatio).toBe(0.91);
  });

  it("falls back to local cost when no rate limits are reported (API users)", () => {
    const api = parseStatuslineInput(fixture("statusline-api.json"));
    const local = {
      computedAt: NOW,
      day: "2026-10-01",
      todayCostUsd: 3,
      block: {
        start: NOW - 3600_000,
        end: NOW + 4 * 3600_000,
        costUsd: 2,
        totalTokens: 10,
        burnRatePerHour: 2,
      },
      sevenDay: { costUsd: 20, totalTokens: 100 },
    };
    const m = buildStatusModel(api, local, {}, NOW);
    expect(m.fiveHour).toEqual({ costUsd: 2, resetsAt: NOW + 4 * 3600_000, resetEstimated: true });
    expect(m.sevenDay).toEqual({ costUsd: 20 });
    expect(m.contextPercent).toBeUndefined(); // null early in a session
    expect(m.todayCostUsd).toBe(3);
  });

  it("projects time to limit from recorded samples", () => {
    const input = {
      rate_limits: { five_hour: { used_percentage: 30, resets_at: (NOW + 4 * 3600_000) / 1000 } },
    };
    const samples: SampleState = {};
    recordSample(samples, "fiveHour", NOW + 4 * 3600_000, 20, NOW - 30 * 60_000);
    recordSample(samples, "fiveHour", NOW + 4 * 3600_000, 30, NOW);
    const m = buildStatusModel(input, undefined, samples, NOW);
    expect(m.fiveHour?.msToLimit).toBeCloseTo(3.5 * 3600_000, -3);
  });

  it("labels unknown models with Claude Code's display name", () => {
    expect(modelLabel({ model: { id: "claude-next-9", display_name: "Next" } })).toBe("Next");
  });
});

describe("recordSample", () => {
  it("starts over when the window changes or usage drops", () => {
    const s: SampleState = {};
    recordSample(s, "fiveHour", 1_000_000, 10, 0);
    recordSample(s, "fiveHour", 1_000_000, 20, 60_000);
    expect(s.fiveHour!.samples).toHaveLength(2);
    recordSample(s, "fiveHour", 9_000_000, 1, 120_000);
    expect(s.fiveHour!.samples).toEqual([{ at: 120_000, percent: 1 }]);
    recordSample(s, "fiveHour", 9_000_000, 0, 180_000);
    expect(s.fiveHour!.samples).toEqual([{ at: 180_000, percent: 0 }]);
  });
});

describe("computeSummary", () => {
  const ev = (iso: string, input: number): UsageEvent => ({
    id: iso,
    timestamp: iso,
    tool: "claude-code",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    inputTokens: input,
    outputTokens: 0,
    source: "local-log",
  });

  it("estimates against user-configured limits", () => {
    const now = new Date(NOW);
    const events = [ev("2026-10-01T11:00:00Z", 1_000_000), ev("2026-10-01T11:30:00Z", 1_000_000)];
    const s = computeSummary(
      events,
      cfg({ limits: { fiveHour: { costUsd: 4 }, sevenDay: { costUsd: 20 } } }),
      now,
    );
    expect(s.block?.costUsd).toBeCloseTo(2);
    expect(s.block?.estimate?.usedPercent).toBeCloseTo(50);
    expect(s.sevenDay.estimate?.usedPercent).toBeCloseTo(10);
  });
});

describe("installStatusLine / uninstallStatusLine", () => {
  const ours: StatusLineSetting = {
    type: "command",
    command: "node /x/burnrate/dist/cli.js statusline",
    padding: 0,
  };
  const setup = (content?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "burnrate-settings-"));
    const p = join(dir, "settings.json");
    if (content !== undefined) writeFileSync(p, content);
    return { dir, p };
  };

  it("creates settings.json when missing, with no backup", () => {
    const { dir, p } = setup();
    const r = installStatusLine(p, ours);
    expect(r.ok && r.changed && r.backupPath).toBe(undefined);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ statusLine: ours });
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("preserves other settings and backs up the original", () => {
    const { p } = setup('{"model":"opus","permissions":{"allow":["Bash(ls)"]}}');
    const r = installStatusLine(p, ours);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(existsSync(r.backupPath!)).toBe(true);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({
      model: "opus",
      permissions: { allow: ["Bash(ls)"] },
      statusLine: ours,
    });
  });

  it("refuses to replace a foreign status line without force, then restores it on uninstall", () => {
    const foreign = { type: "command", command: "~/mine.sh" };
    const { p } = setup(JSON.stringify({ statusLine: foreign }));
    const refused = installStatusLine(p, ours);
    expect(refused.ok).toBe(false);
    const r = installStatusLine(p, ours, { force: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(uninstallStatusLine(p, r.record)).toEqual({ ok: true, changed: true, restored: foreign });
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ statusLine: foreign });
  });

  it("does nothing on invalid JSON", () => {
    const { p } = setup("{ broken");
    const r = installStatusLine(p, ours);
    expect(r).toMatchObject({ ok: false, reason: "invalid-json" });
    expect(readFileSync(p, "utf8")).toBe("{ broken");
  });

  it("dry run changes nothing", () => {
    const { p } = setup("{}");
    installStatusLine(p, ours, { dryRun: true });
    expect(readFileSync(p, "utf8")).toBe("{}");
  });

  it("uninstall leaves a foreign status line alone", () => {
    const { p } = setup('{"statusLine":{"type":"command","command":"x.sh"}}');
    expect(uninstallStatusLine(p)).toMatchObject({ ok: false, reason: "foreign-statusline" });
  });
});

describe("report helpers", () => {
  it("parses absolute and relative dates", () => {
    const now = new Date(NOW);
    expect(parseDateArg("7d", now)?.getTime()).toBe(NOW - 7 * 86_400_000);
    expect(parseDateArg("12h", now)?.getTime()).toBe(NOW - 12 * 3_600_000);
    expect(parseDateArg("2026-10-01")?.getDate()).toBe(1);
    expect(parseDateArg("last week")).toBeUndefined();
  });

  it("extracts project names from Unix and Windows paths", () => {
    expect(projectName("/home/dev/acme-api")).toBe("acme-api");
    expect(projectName("C:\\work\\web\\")).toBe("web");
  });

  it("filters by project and model substring", () => {
    const base = { tool: "t", provider: "p", inputTokens: 1, outputTokens: 1, source: "local-log" as const };
    const events: UsageEvent[] = [
      { ...base, id: "1", timestamp: "2026-10-01T00:00:00Z", model: "claude-opus-5-5", project: "/a/web" },
      { ...base, id: "2", timestamp: "2026-10-01T00:00:00Z", model: "claude-haiku-4-5", project: "/a/api" },
    ];
    expect(filterEvents(events, { project: "WEB" }).map((e) => e.id)).toEqual(["1"]);
    expect(filterEvents(events, { model: "haiku" }).map((e) => e.id)).toEqual(["2"]);
  });

  it("builds a blocks report", () => {
    const base = {
      tool: "t",
      provider: "p",
      model: "claude-haiku-4-5",
      inputTokens: 1,
      outputTokens: 1,
      source: "local-log" as const,
    };
    const r = buildReport(
      [
        { ...base, id: "1", timestamp: "2026-10-01T09:10:00Z" },
        { ...base, id: "2", timestamp: "2026-10-01T15:10:00Z" },
      ],
      "blocks",
      new Date("2026-10-01T16:00:00Z"),
    );
    expect(r.rows.map((x) => x.extra?.[0])).toEqual(["0m", "active"]);
  });

  it("renders aligned tables and escaped CSV", () => {
    expect(
      renderTable(
        ["A", "B"],
        [
          ["x", "1"],
          ["yy", "22"],
        ],
      ).split("\n"),
    ).toEqual(["A    B", "──  ──", "x    1", "yy  22"]);
    expect(toCsv(["a"], [['he said "hi", ok']])).toBe('a\n"he said ""hi"", ok"');
  });
});

describe("report polish", () => {
  const base = {
    tool: "t",
    provider: "p",
    inputTokens: 1_000_000,
    outputTokens: 0,
    source: "local-log" as const,
  };
  const events: UsageEvent[] = [
    {
      ...base,
      id: "1",
      timestamp: "2026-10-01T09:00:00Z",
      model: "claude-haiku-4-5-20251001",
      sessionId: "aaaaaaaa-1",
      project: "/w/api",
    },
    {
      ...base,
      id: "2",
      timestamp: "2026-10-01T10:00:00Z",
      model: "claude-haiku-4-5",
      sessionId: "aaaaaaaa-1",
      project: "/w/api",
    },
    {
      ...base,
      id: "3",
      timestamp: "2026-10-02T10:00:00Z",
      model: "claude-opus-5-5",
      sessionId: "bbbbbbbb-2",
      project: "/w/web",
    },
  ];

  it("merges dated and undated ids of the same model into one row", () => {
    const r = buildReport(events, "models");
    expect(r.rows.map((x) => [x.key, x.totals.requests])).toEqual([
      ["claude-opus-5-5", 1],
      ["claude-haiku-4-5", 2],
    ]);
  });

  it("shows when each session started and in which project", () => {
    const r = buildReport(events, "sessions");
    expect(r.extraHeaders).toEqual(["Started", "Project"]);
    const api = r.rows.find((x) => x.key === "aaaaaaaa-1")!;
    expect(api.extra?.[1]).toBe("api");
    expect(api.extra?.[0]).not.toBe("");
  });

  it("sums hidden rows so a limited table still adds up", () => {
    const r = buildReport(events, "sessions");
    const rest = mergeTotals(r.rows.slice(1).map((x) => x.totals));
    expect(r.rows[0]!.totals.requests + rest.requests).toBe(r.totals.requests);
    expect(r.rows[0]!.totals.costUsd + rest.costUsd).toBeCloseTo(r.totals.costUsd, 10);
  });

  it("left-aligns label columns", () => {
    const out = renderTable(
      ["A", "Project", "N"],
      [
        ["x", "api", "1"],
        ["yy", "website", "22"],
      ],
      undefined,
      2,
    );
    expect(out.split("\n")[2]).toBe("x   api       1");
  });
});

describe("status snapshot", () => {
  it("remembers the latest rate limits and recent sessions", () => {
    const pro = parseStatuslineInput(fixture("statusline-pro.json"));
    const api = parseStatuslineInput(fixture("statusline-api.json"));
    const a = updateSnapshot(undefined, pro, 1000);
    expect(a.rateLimits?.five_hour?.used_percentage).toBe(72.4);
    expect(a.recentSessions.map((s) => s.id)).toEqual(["sess-1111"]);
    // An API-key session has no rate limits: keep the last known ones.
    const b = updateSnapshot(a, api, 2000);
    expect(b.rateLimitsAt).toBe(1000);
    expect(b.sessionId).toBe("sess-2222");
    expect(b.recentSessions.map((s) => s.id)).toEqual(["sess-2222", "sess-1111"]);
    const c = updateSnapshot(b, pro, 3000);
    expect(c.recentSessions.map((s) => s.id)).toEqual(["sess-1111", "sess-2222"]);
  });
});
