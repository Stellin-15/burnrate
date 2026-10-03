import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { USD, type CurrencyConfig } from "./format.js";
import type { WindowLimit } from "./windows.js";

export const WIDGETS = [
  "model",
  "fiveHour",
  "sevenDay",
  "spendLimit",
  "context",
  "sessionCost",
  "todayCost",
  "blockCost",
  "burnRate",
  "cache",
] as const;
export type WidgetId = (typeof WIDGETS)[number];

export const THEMES = ["default", "minimal", "plain"] as const;
export type ThemeId = (typeof THEMES)[number];

export interface BurnrateConfig {
  /** Status line look: "default" (colors + bars), "minimal" (colors, no bars), "plain" (no color, ASCII). */
  theme: ThemeId;
  /** Widgets in display order. Widgets with no data are skipped. */
  widgets: WidgetId[];
  /** Percent thresholds for yellow and red. */
  thresholds: { warn: number; danger: number };
  /** Bar width in characters. */
  barWidth: number;
  /**
   * Your own limits, used only when the tool doesn't report real ones (e.g. API-key users or other tools).
   * Values are estimates you choose; BurnRate does not know your plan's real limits.
   */
  limits: { fiveHour?: WindowLimit; sevenDay?: WindowLimit };
  currency: CurrencyConfig;
  /** How long a transcript scan stays fresh for the status line, in seconds. */
  cacheSeconds: number;
  /** Extra Claude Code config directories to scan (defaults are auto-detected). */
  claudeDirs: string[];
}

export const DEFAULT_CONFIG: BurnrateConfig = {
  theme: "default",
  widgets: ["model", "fiveHour", "sevenDay", "spendLimit", "context", "sessionCost", "todayCost"],
  thresholds: { warn: 60, danger: 85 },
  barWidth: 8,
  limits: {},
  currency: USD,
  cacheSeconds: 20,
  claudeDirs: [],
};

/** BurnRate's own data directory. Override with BURNRATE_HOME. */
export function burnrateHome(env = process.env): string {
  return env.BURNRATE_HOME || join(homedir(), ".burnrate");
}

/** Config file path. Override with BURNRATE_CONFIG. */
export function configPath(env = process.env): string {
  return env.BURNRATE_CONFIG || join(burnrateHome(env), "config.json");
}

export interface LoadedConfig {
  config: BurnrateConfig;
  path: string;
  exists: boolean;
  /** Problems found; invalid values fall back to defaults instead of failing. */
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const posNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

function readLimit(v: unknown, name: string, warnings: string[]): WindowLimit | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) {
    warnings.push(`limits.${name} must be an object like {"costUsd": 50}`);
    return undefined;
  }
  const out: WindowLimit = {};
  if (v.costUsd !== undefined) {
    if (posNum(v.costUsd)) out.costUsd = v.costUsd;
    else warnings.push(`limits.${name}.costUsd must be a positive number`);
  }
  if (v.tokens !== undefined) {
    if (posNum(v.tokens)) out.tokens = v.tokens;
    else warnings.push(`limits.${name}.tokens must be a positive number`);
  }
  return out.costUsd || out.tokens ? out : undefined;
}

/** Validate a parsed config object, merging it over defaults. Never throws. */
export function resolveConfig(raw: unknown): { config: BurnrateConfig; warnings: string[] } {
  const warnings: string[] = [];
  const c: BurnrateConfig = structuredClone(DEFAULT_CONFIG);
  if (raw === undefined) return { config: c, warnings };
  if (!isObj(raw)) return { config: c, warnings: ["config must be a JSON object"] };

  const known = new Set<string>([...Object.keys(DEFAULT_CONFIG), "$schema"]);
  for (const k of Object.keys(raw)) if (!known.has(k)) warnings.push(`unknown key "${k}" ignored`);

  if (raw.theme !== undefined) {
    if ((THEMES as readonly unknown[]).includes(raw.theme)) c.theme = raw.theme as ThemeId;
    else warnings.push(`theme must be one of ${THEMES.join(", ")}`);
  }
  if (raw.widgets !== undefined) {
    if (Array.isArray(raw.widgets)) {
      const bad = raw.widgets.filter((w) => !(WIDGETS as readonly unknown[]).includes(w));
      if (bad.length) warnings.push(`unknown widget(s) ignored: ${bad.join(", ")}. Valid: ${WIDGETS.join(", ")}`);
      c.widgets = raw.widgets.filter((w): w is WidgetId => (WIDGETS as readonly unknown[]).includes(w));
    } else warnings.push("widgets must be an array");
  }
  if (raw.thresholds !== undefined) {
    const t = raw.thresholds;
    if (isObj(t) && posNum(t.warn) && posNum(t.danger) && t.warn < t.danger) c.thresholds = { warn: t.warn, danger: t.danger };
    else warnings.push("thresholds must be {warn, danger} with 0 < warn < danger");
  }
  if (raw.barWidth !== undefined) {
    if (Number.isInteger(raw.barWidth) && (raw.barWidth as number) >= 3 && (raw.barWidth as number) <= 40)
      c.barWidth = raw.barWidth as number;
    else warnings.push("barWidth must be an integer from 3 to 40");
  }
  if (raw.limits !== undefined) {
    if (isObj(raw.limits)) {
      const fiveHour = readLimit(raw.limits.fiveHour, "fiveHour", warnings);
      const sevenDay = readLimit(raw.limits.sevenDay, "sevenDay", warnings);
      c.limits = { ...(fiveHour && { fiveHour }), ...(sevenDay && { sevenDay }) };
    } else warnings.push("limits must be an object");
  }
  if (raw.currency !== undefined) {
    const cur = raw.currency;
    if (isObj(cur) && typeof cur.code === "string" && typeof cur.symbol === "string" && posNum(cur.rateFromUsd))
      c.currency = { code: cur.code, symbol: cur.symbol, rateFromUsd: cur.rateFromUsd };
    else warnings.push('currency must be {"code": "EUR", "symbol": "€", "rateFromUsd": 0.92}');
  }
  if (raw.cacheSeconds !== undefined) {
    if (typeof raw.cacheSeconds === "number" && raw.cacheSeconds >= 0) c.cacheSeconds = raw.cacheSeconds;
    else warnings.push("cacheSeconds must be a number >= 0");
  }
  if (raw.claudeDirs !== undefined) {
    if (Array.isArray(raw.claudeDirs) && raw.claudeDirs.every((d) => typeof d === "string")) c.claudeDirs = raw.claudeDirs;
    else warnings.push("claudeDirs must be an array of paths");
  }
  return { config: c, warnings };
}

/** Load the config file if present. Never throws: a broken file yields defaults plus a warning. */
export function loadConfig(path = configPath()): LoadedConfig {
  if (!existsSync(path)) return { config: structuredClone(DEFAULT_CONFIG), path, exists: false, warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      path,
      exists: true,
      warnings: [`could not parse ${path}: ${(err as Error).message}`],
    };
  }
  return { ...resolveConfig(raw), path, exists: true };
}
