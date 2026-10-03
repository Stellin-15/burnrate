import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  SEVEN_DAYS,
  dayKey,
  burnrateHome,
  loadConfig,
  projectFromSamples,
  type BurnrateConfig,
} from "@burnrate/core";
import { findModelPricing } from "@burnrate/pricing";
import {
  claudeConfigDirs,
  loadClaudeCodeEvents,
  parseStatuslineInput,
  type StatuslineInput,
} from "@burnrate/adapter-claude-code";
import { colorEnabled } from "../ansi.js";
import { recordSnapshot } from "../snapshot.js";
import { renderStatusLine, type StatusModel } from "../render.js";
import {
  computeSummary,
  readJson,
  recordSample,
  writeJsonQuiet,
  type LocalSummary,
  type SampleState,
} from "../summary.js";

const WIDGETS_NEEDING_LOCAL = new Set(["todayCost", "blockCost", "burnRate"]);

/** Read all of stdin, giving up after `timeoutMs` so a missing pipe can't hang the status line. */
export function readStdin(timeoutMs = 1000): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const done = () => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(done, timeoutMs);
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}

/** "claude-opus-5-5" -> "Opus 5.5"; falls back to Claude Code's display name. */
export function modelLabel(input: StatuslineInput): string | undefined {
  const id = input.model?.id;
  const known = id ? findModelPricing(id) : undefined;
  if (known) return known.displayName.replace(/^Claude /, "");
  return input.model?.display_name ?? id;
}

function needsLocalData(input: StatuslineInput, config: BurnrateConfig): boolean {
  const w = config.widgets;
  if (w.some((id) => WIDGETS_NEEDING_LOCAL.has(id))) return true;
  if (w.includes("fiveHour") && input.rate_limits?.five_hour?.used_percentage === undefined) return true;
  if (w.includes("sevenDay") && input.rate_limits?.seven_day?.used_percentage === undefined) return true;
  return false;
}

/** Local summary from cache if fresh, else rescan transcripts (incrementally) and refresh the cache. */
function getLocalSummary(config: BurnrateConfig, home: string, now: Date): LocalSummary | undefined {
  const summaryPath = join(home, "cache", "statusline-summary.json");
  const cached = readJson<LocalSummary>(summaryPath);
  if (
    cached &&
    cached.day === dayKey(now) &&
    now.getTime() - cached.computedAt >= 0 &&
    now.getTime() - cached.computedAt < config.cacheSeconds * 1000
  )
    return cached;

  const dirs = claudeConfigDirs(config.claudeDirs);
  if (!dirs.length) return undefined;
  const events = loadClaudeCodeEvents({
    dirs,
    since: new Date(now.getTime() - SEVEN_DAYS - 24 * 60 * 60 * 1000),
    cachePath: join(home, "cache", "claude-code-events.json"),
  });
  const summary = computeSummary(events, config, now);
  writeJsonQuiet(summaryPath, summary);
  return summary;
}

/** Combine Claude Code's own numbers (preferred) with local estimates (fallback). */
export function buildStatusModel(
  input: StatuslineInput,
  local: LocalSummary | undefined,
  samples: SampleState,
  now: number,
): StatusModel {
  const m: StatusModel = {};
  m.model = modelLabel(input);
  if (input.fast_mode) m.fast = true;

  const rl = input.rate_limits;
  for (const [key, win] of [
    ["fiveHour", rl?.five_hour],
    ["sevenDay", rl?.seven_day],
  ] as const) {
    if (win?.used_percentage === undefined) continue;
    const resetsAt = win.resets_at !== undefined ? win.resets_at * 1000 : undefined;
    const s = samples[key];
    const msToLimit = resetsAt !== undefined && s ? projectFromSamples(s.samples, resetsAt, now) : undefined;
    m[key] = { percent: win.used_percentage, resetsAt, msToLimit };
  }
  if (!m.fiveHour && local?.block) {
    const b = local.block;
    m.fiveHour = b.estimate
      ? { percent: b.estimate.usedPercent, estimated: true, resetsAt: b.end, msToLimit: b.estimate.msToLimit }
      : { costUsd: b.costUsd, resetsAt: b.end };
  }
  if (!m.sevenDay && local) {
    const est = local.sevenDay.estimate;
    m.sevenDay = est
      ? { percent: est.usedPercent, estimated: true, resetsAt: est.resetsAt }
      : { costUsd: local.sevenDay.costUsd };
  }

  const sl = rl?.spend_limit;
  if (sl?.used_percentage !== undefined) {
    m.spendLimit = {
      percent: sl.used_percentage,
      usedUsd: sl.used_usd,
      limitUsd: sl.limit_usd,
      resetsAt: sl.resets_at !== undefined ? sl.resets_at * 1000 : undefined,
    };
  }
  const ctx = input.context_window?.used_percentage;
  if (typeof ctx === "number") m.contextPercent = ctx;
  if (typeof input.cost?.total_cost_usd === "number") m.sessionCostUsd = input.cost.total_cost_usd;
  if (typeof input.prompt_cache?.hit_ratio === "number") m.cacheHitRatio = input.prompt_cache.hit_ratio;
  if (local) {
    m.todayCostUsd = local.todayCostUsd;
    if (local.block) {
      m.blockCostUsd = local.block.costUsd;
      m.burnRatePerHour = local.block.burnRatePerHour;
    }
  }
  return m;
}

/** Sample data for `burnrate statusline --demo`, so people can preview themes without Claude Code. */
export function demoModel(now: number): StatusModel {
  return {
    model: "Opus 5.5",
    fiveHour: { percent: 72, resetsAt: now + 72 * 60_000, msToLimit: 48 * 60_000 },
    sevenDay: { percent: 41, resetsAt: now + (3 * 24 + 4) * 3600_000 },
    contextPercent: 31,
    sessionCostUsd: 1.23,
    todayCostUsd: 12.8,
    blockCostUsd: 4.1,
    burnRatePerHour: 2.35,
    cacheHitRatio: 0.91,
  };
}

function logError(home: string, err: unknown): void {
  try {
    mkdirSync(join(home, "logs"), { recursive: true });
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    appendFileSync(join(home, "logs", "statusline-errors.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // nothing else we can do
  }
}

export async function runStatusline(args: { demo?: boolean; theme?: string }): Promise<number> {
  const home = burnrateHome();
  const now = Date.now();
  const { config } = loadConfig();
  if (args.theme && ["default", "minimal", "plain"].includes(args.theme))
    config.theme = args.theme as BurnrateConfig["theme"];
  // Claude Code captures stdout (not a TTY) but renders ANSI, so color is on unless NO_COLOR is set.
  const color = !process.env.NO_COLOR;
  const columns = Number(process.env.COLUMNS) || undefined;

  if (args.demo) {
    const demoConfig = {
      ...config,
      widgets: [...config.widgets, "blockCost", "burnRate", "cache"] as BurnrateConfig["widgets"],
    };
    console.log(renderStatusLine(demoModel(now), { config: demoConfig, color: colorEnabled(), now }));
    return 0;
  }

  let input: StatuslineInput = {};
  try {
    input = parseStatuslineInput(await readStdin());
    const statePath = join(home, "state", "ratelimit-samples.json");
    const samples = readJson<SampleState>(statePath) ?? {};
    let samplesChanged = false;
    for (const [key, win] of [
      ["fiveHour", input.rate_limits?.five_hour],
      ["sevenDay", input.rate_limits?.seven_day],
    ] as const) {
      if (win?.used_percentage !== undefined && win.resets_at !== undefined) {
        recordSample(samples, key, win.resets_at * 1000, win.used_percentage, now);
        samplesChanged = true;
      }
    }
    if (samplesChanged) writeJsonQuiet(statePath, samples);

    const local = needsLocalData(input, config) ? getLocalSummary(config, home, new Date(now)) : undefined;
    const line = renderStatusLine(buildStatusModel(input, local, samples, now), {
      config,
      color,
      columns,
      now,
    });
    process.stdout.write(line + "\n");
    recordSnapshot(join(home, "state", "last-status.json"), input, now);
  } catch (err) {
    // Never break the user's status line: show what we can and log the rest.
    logError(home, err);
    const fallback = modelLabel(input);
    process.stdout.write(`${fallback ? `${fallback} │ ` : ""}burnrate: see ~/.burnrate/logs\n`);
  }
  return 0;
}
