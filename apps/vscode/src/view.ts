import { formatDuration, formatMoney, type BurnrateConfig } from "@burnrate/core";
import type { StatusSnapshot } from "../../../packages/cli/src/snapshot.js";
import type { LocalSummary } from "../../../packages/cli/src/summary.js";

export interface WindowInfo {
  id: "fiveHour" | "sevenDay" | "spendLimit";
  label: string;
  /** Percent used, when known. */
  percent?: number;
  /** True when BurnRate estimated it from your configured limits rather than Claude Code reporting it. */
  estimated?: boolean;
  resetsAt?: number;
  costUsd?: number;
}

export interface StatusView {
  /** Status bar text (may contain $(codicon) references). */
  text: string;
  /** Markdown tooltip. */
  tooltip: string;
  /** Background emphasis for the status bar item. */
  level: "normal" | "warning" | "error";
  windows: WindowInfo[];
  /** The same meter as plain text (no codicons), for places like a view header. */
  headline: string;
  /** One entry per line for list views (e.g. the BurnRate section in Claude Code's sidebar). */
  rows: Array<{ id: string; label: string; value: string; level: "normal" | "warning" | "error" }>;
  /** Shown when real plan limits are missing, explaining how to get them. */
  hint?: string;
}

const SHORT = { fiveHour: "5h", sevenDay: "7d", spendLimit: "spend" } as const;
const LONG = { fiveHour: "Session (5-hour)", sevenDay: "Weekly", spendLimit: "Spend limit" } as const;

/** Real limits from the status line snapshot; local estimates only when Claude Code reported none. */
export function collectWindows(
  snapshot: StatusSnapshot | undefined,
  local: LocalSummary | undefined,
  now: number,
) {
  const out: WindowInfo[] = [];
  const rl = snapshot?.rateLimits;
  for (const id of ["fiveHour", "sevenDay", "spendLimit"] as const) {
    const w = id === "fiveHour" ? rl?.five_hour : id === "sevenDay" ? rl?.seven_day : rl?.spend_limit;
    // A window whose reset time has passed is stale: its percentage no longer applies.
    if (w?.used_percentage !== undefined && w.resets_at !== undefined && w.resets_at * 1000 > now) {
      out.push({ id, label: LONG[id], percent: w.used_percentage, resetsAt: w.resets_at * 1000 });
    }
  }
  if (!out.some((w) => w.id === "fiveHour") && local?.block && local.block.end > now) {
    const est = local.block.estimate;
    out.push({
      id: "fiveHour",
      label: LONG.fiveHour,
      ...(est ? { percent: est.usedPercent, estimated: true } : { costUsd: local.block.costUsd }),
      resetsAt: local.block.end,
    });
  }
  if (!out.some((w) => w.id === "sevenDay") && local?.sevenDay.estimate) {
    out.push({
      id: "sevenDay",
      label: LONG.sevenDay,
      percent: local.sevenDay.estimate.usedPercent,
      estimated: true,
      resetsAt: local.sevenDay.estimate.resetsAt,
    });
  }
  const order = { fiveHour: 0, sevenDay: 1, spendLimit: 2 };
  return out.sort((a, b) => order[a.id] - order[b.id]);
}

export function buildView(
  snapshot: StatusSnapshot | undefined,
  local: LocalSummary | undefined,
  config: BurnrateConfig,
  opts: { now?: number; showTodayCost?: boolean } = {},
): StatusView {
  const now = opts.now ?? Date.now();
  const money = (usd: number) => formatMoney(usd, config.currency);
  const windows = collectWindows(snapshot, local, now);

  const parts = windows.map((w) => {
    const value =
      w.percent !== undefined
        ? `${w.estimated ? "~" : ""}${Math.round(w.percent)}%`
        : w.costUsd !== undefined
          ? money(w.costUsd)
          : "";
    // Session and weekly limits both show when they reset; the spend limit's period is in the tooltip.
    const reset = w.id !== "spendLimit" && w.resetsAt ? ` ↻ ${formatDuration(w.resetsAt - now)}` : "";
    return `${SHORT[w.id]} ${value}${reset}`;
  });
  if (opts.showTodayCost !== false && local) parts.push(`${money(local.todayCostUsd)} today`);

  const worst = Math.max(-1, ...windows.map((w) => w.percent ?? -1));
  const level =
    worst >= config.thresholds.danger ? "error" : worst >= config.thresholds.warn ? "warning" : "normal";
  const headline = parts.join(" │ ");
  const text = `$(pulse) ${headline || "BurnRate"}`;
  const levelOf = (pct?: number): StatusView["level"] =>
    pct === undefined
      ? "normal"
      : pct >= config.thresholds.danger
        ? "error"
        : pct >= config.thresholds.warn
          ? "warning"
          : "normal";
  const listRows: StatusView["rows"] = windows.map((w) => ({
    id: w.id,
    label: w.label,
    value: `${w.percent !== undefined ? `${w.estimated ? "~" : ""}${Math.round(w.percent)}% used` : w.costUsd !== undefined ? `${money(w.costUsd)} spent` : ""}${w.resetsAt ? `, resets in ${formatDuration(w.resetsAt - now)}` : ""}`,
    level: levelOf(w.percent),
  }));
  if (local) {
    listRows.push({ id: "today", label: "Today", value: money(local.todayCostUsd), level: "normal" });
    if (local.block && local.block.end > now && local.block.burnRatePerHour > 0)
      listRows.push({
        id: "burn",
        label: "Burn rate",
        value: `${money(local.block.burnRatePerHour)}/h`,
        level: "normal",
      });
    listRows.push({
      id: "week",
      label: "Last 7 days",
      value: money(local.sevenDay.costUsd),
      level: "normal",
    });
  }
  const hasRealLimits = windows.some((w) => !w.estimated && w.percent !== undefined);
  const hint = hasRealLimits
    ? undefined
    : "Plan limits load when Claude Code runs in a terminal with the BurnRate status line. Open a terminal, run claude, and send a message.";

  // Tooltip: the full picture, plus where each number came from.
  const rows: string[] = ["| | |", "|:--|--:|"];
  for (const w of windows) {
    const value =
      w.percent !== undefined
        ? `${w.estimated ? "~" : ""}${Math.round(w.percent)}% used`
        : w.costUsd !== undefined
          ? `${money(w.costUsd)} spent`
          : "";
    const reset = w.resetsAt ? `, resets in ${formatDuration(w.resetsAt - now)}` : "";
    rows.push(`| **${w.label}** | ${value}${reset} |`);
  }
  if (local) {
    rows.push(`| **Today** | ${money(local.todayCostUsd)} |`);
    if (local.block && local.block.end > now) {
      rows.push(`| **This 5-hour block** | ${money(local.block.costUsd)} |`);
      if (local.block.burnRatePerHour > 0)
        rows.push(`| **Burn rate** | ${money(local.block.burnRatePerHour)}/h |`);
    }
    rows.push(`| **Last 7 days** | ${money(local.sevenDay.costUsd)} |`);
  }

  const notes: string[] = [];
  if (snapshot?.rateLimitsAt && windows.some((w) => !w.estimated && w.percent !== undefined)) {
    notes.push(
      `Plan limits from Claude Code, as of ${new Date(snapshot.rateLimitsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`,
    );
  } else {
    notes.push(
      "Plan limits appear after Claude Code runs in a terminal with the BurnRate status line installed (`burnrate init claude-code`). The chat panel doesn't report them.",
    );
  }
  if (windows.some((w) => w.estimated))
    notes.push("`~` marks estimates from the limits in your BurnRate config.");
  if (local)
    notes.push("Costs are API list-price equivalents; on a Pro or Max plan you aren't billed per token.");

  const tooltip = [
    "**BurnRate**",
    "",
    rows.length > 2 ? rows.join("\n") : "No Claude Code usage found yet.",
    "",
    notes.join(" "),
    "",
    "[Open dashboard](command:burnrate.openDashboard) · [Refresh](command:burnrate.refresh)",
  ].join("\n");

  return { text, tooltip, level, windows, headline, rows: listRows, hint };
}

/**
 * How to start the dashboard. Prefer the exact node + script that `burnrate init claude-code`
 * wrote into Claude Code's settings, so it works without BurnRate on PATH.
 */
export function dashboardLaunch(
  statusLineCommand: string | undefined,
): { shellPath: string; shellArgs: string[] } | undefined {
  if (!statusLineCommand) return undefined;
  const m = /^\s*(?:"([^"]+)"|(\S+))\s+(?:"([^"]+)"|(\S+))\s+statusline\s*$/.exec(statusLineCommand);
  if (!m) return undefined;
  const node = m[1] ?? m[2]!;
  const script = m[3] ?? m[4]!;
  if (!/burnrate|cli\.js/i.test(script)) return undefined;
  return { shellPath: node, shellArgs: [script, "dashboard"] };
}
