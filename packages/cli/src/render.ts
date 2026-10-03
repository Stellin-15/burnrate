import {
  formatDuration,
  formatMoney,
  formatPercent,
  visibleLength,
  type BurnrateConfig,
  type WidgetId,
} from "@burnrate/core";
import { paintAnsi, paintNone, type Color, type Paint } from "./ansi.js";

/** Everything the status line can show. Every field is optional; widgets without data are skipped. */
export interface StatusModel {
  model?: string;
  fast?: boolean;
  fiveHour?: WindowView;
  sevenDay?: WindowView;
  spendLimit?: { percent: number; usedUsd?: number; limitUsd?: number; resetsAt?: number };
  contextPercent?: number;
  sessionCostUsd?: number;
  todayCostUsd?: number;
  blockCostUsd?: number;
  burnRatePerHour?: number;
  cacheHitRatio?: number;
}

export interface WindowView {
  /** Percent of limit used. Absent when no limit is known; then costUsd is shown instead. */
  percent?: number;
  /** True when percent is BurnRate's estimate rather than the tool's own number. */
  estimated?: boolean;
  /** Epoch ms. */
  resetsAt?: number;
  /** Projected ms until the limit is reached, if before reset. */
  msToLimit?: number;
  costUsd?: number;
}

export interface RenderOptions {
  config: BurnrateConfig;
  /** Use ANSI colors. Ignored (off) for the "plain" theme. */
  color: boolean;
  /** Available width; widgets are dropped from the end until the line fits. */
  columns?: number;
  now?: number;
}

function levelColor(pct: number, cfg: BurnrateConfig): Color {
  if (pct >= cfg.thresholds.danger) return "red";
  if (pct >= cfg.thresholds.warn) return "yellow";
  return "green";
}

function bar(pct: number, width: number, ascii: boolean): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return ascii
    ? `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`
    : `${"▰".repeat(filled)}${"▱".repeat(width - filled)}`;
}

/** Render the status line. Pure: same inputs, same output. */
export function renderStatusLine(m: StatusModel, opts: RenderOptions): string {
  const { config } = opts;
  const now = opts.now ?? Date.now();
  const plain = config.theme === "plain";
  const showBars = config.theme !== "minimal";
  const paint: Paint = opts.color && !plain ? paintAnsi : paintNone;
  const money = (usd: number) => formatMoney(usd, config.currency);
  const label = (s: string) => paint("dim", s);
  const resetIcon = plain ? "reset " : "↻";
  const warnIcon = plain ? "!" : "⚠";

  const windowWidget = (name: string, w: WindowView | undefined, withBar: boolean): string | undefined => {
    if (!w) return undefined;
    if (w.percent === undefined)
      return w.costUsd !== undefined ? `${label(name)} ${money(w.costUsd)}` : undefined;
    const c = levelColor(w.percent, config);
    const pct = `${w.estimated ? "~" : ""}${formatPercent(w.percent)}`;
    const parts = [label(name)];
    if (withBar) parts.push(paint(c, bar(w.percent, config.barWidth, plain)));
    parts.push(paint(c, pct));
    if (w.resetsAt !== undefined && w.resetsAt > now)
      parts.push(label(`${resetIcon}${formatDuration(w.resetsAt - now)}`));
    if (w.msToLimit !== undefined)
      parts.push(paint("red", `${warnIcon} limit in ${formatDuration(w.msToLimit)}`));
    return parts.join(" ");
  };

  const widgets: Record<WidgetId, () => string | undefined> = {
    model: () =>
      m.model
        ? paint("bold", m.model) + (m.fast ? paint("magenta", plain ? " fast" : " ⚡") : "")
        : undefined,
    fiveHour: () => windowWidget("5h", m.fiveHour, showBars),
    sevenDay: () => windowWidget("7d", m.sevenDay, false),
    spendLimit: () => {
      const s = m.spendLimit;
      if (!s) return undefined;
      const c = levelColor(s.percent, config);
      const amount =
        s.usedUsd !== undefined && s.limitUsd !== undefined
          ? `${money(s.usedUsd)}/${money(s.limitUsd)} `
          : "";
      return `${label("spend")} ${paint(c, `${amount}${formatPercent(s.percent)}`)}`;
    },
    context: () =>
      m.contextPercent === undefined
        ? undefined
        : `${label("ctx")} ${paint(levelColor(m.contextPercent, config), formatPercent(m.contextPercent))}`,
    sessionCost: () =>
      m.sessionCostUsd === undefined ? undefined : `${money(m.sessionCostUsd)} ${label("session")}`,
    todayCost: () =>
      m.todayCostUsd === undefined ? undefined : `${money(m.todayCostUsd)} ${label("today")}`,
    blockCost: () =>
      m.blockCostUsd === undefined ? undefined : `${money(m.blockCostUsd)} ${label("block")}`,
    burnRate: () =>
      m.burnRatePerHour === undefined || m.burnRatePerHour <= 0
        ? undefined
        : `${money(m.burnRatePerHour)}${label("/h")}`,
    cache: () =>
      m.cacheHitRatio === undefined ? undefined : `${label("cache")} ${formatPercent(m.cacheHitRatio * 100)}`,
  };

  const parts = config.widgets.map((id) => widgets[id]()).filter((s): s is string => !!s);
  const sep = label(plain ? " | " : " │ ");
  if (opts.columns && opts.columns > 0) {
    while (parts.length > 1 && visibleLength(parts.join(sep)) > opts.columns) parts.pop();
  }
  return parts.join(sep);
}
