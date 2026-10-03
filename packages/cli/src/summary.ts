import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { claudeConfigDirs, loadClaudeCodeEvents } from "@burnrate/adapter-claude-code";
import {
  SEVEN_DAYS,
  activeBlock,
  blockBurnRate,
  dayKey,
  estimateBlockLimit,
  estimateRollingLimit,
  rollingTotals,
  sumEvents,
  type BurnrateConfig,
  type UsageEvent,
} from "@burnrate/core";

/** Local usage numbers the status line needs, computed from transcripts and cached briefly. */
export interface LocalSummary {
  computedAt: number;
  day: string;
  todayCostUsd: number;
  block?: {
    start: number;
    end: number;
    costUsd: number;
    totalTokens: number;
    burnRatePerHour: number;
    /** Only set when the user configured limits.fiveHour. */
    estimate?: { usedPercent: number; msToLimit?: number };
  };
  sevenDay: {
    costUsd: number;
    totalTokens: number;
    estimate?: { usedPercent: number; resetsAt: number };
  };
}

export function computeSummary(events: UsageEvent[], config: BurnrateConfig, now = new Date()): LocalSummary {
  const today = dayKey(now);
  const todayCostUsd = sumEvents(events.filter((e) => dayKey(new Date(e.timestamp)) === today)).costUsd;
  const week = rollingTotals(events, now);
  const summary: LocalSummary = {
    computedAt: now.getTime(),
    day: today,
    todayCostUsd,
    sevenDay: { costUsd: week.costUsd, totalTokens: week.totalTokens },
  };

  const block = activeBlock(events, now);
  if (block) {
    summary.block = {
      start: block.start.getTime(),
      end: block.end.getTime(),
      costUsd: block.totals.costUsd,
      totalTokens: block.totals.totalTokens,
      burnRatePerHour: blockBurnRate(block, now).costPerHour,
    };
    const est = config.limits.fiveHour && estimateBlockLimit(block, config.limits.fiveHour, now);
    if (est) summary.block.estimate = { usedPercent: est.usedPercent, msToLimit: est.msToLimit };
  }
  const weekEst = config.limits.sevenDay && estimateRollingLimit(events, config.limits.sevenDay, now);
  if (weekEst)
    summary.sevenDay.estimate = { usedPercent: weekEst.usedPercent, resetsAt: weekEst.resetsAt.getTime() };
  return summary;
}

export function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Atomic best-effort write; failures are ignored because these files are caches. */
export function writeJsonQuiet(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, path);
  } catch {
    // ignore
  }
}

/** Percent samples of an official rate-limit window, used to project time-to-limit. */
export interface SampleState {
  [window: string]: { resetsAt: number; samples: Array<{ at: number; percent: number }> } | undefined;
}

const SAMPLE_SPAN_MS = 60 * 60 * 1000;

/** Record a new sample, dropping samples from older windows or older than an hour. Mutates and returns state. */
export function recordSample(
  state: SampleState,
  window: string,
  resetsAt: number,
  percent: number,
  now: number,
): SampleState {
  let w = state[window];
  // resets_at can jitter by a second between responses; treat anything within a minute as the same window.
  if (!w || Math.abs(w.resetsAt - resetsAt) > 60_000) w = { resetsAt, samples: [] };
  const last = w.samples.at(-1);
  if (!last || last.percent !== percent || now - last.at > 5 * 60_000) w.samples.push({ at: now, percent });
  // Usage only goes up inside a window; a drop means the old samples are stale.
  if (last && percent < last.percent) w.samples = [{ at: now, percent }];
  w.samples = w.samples.filter((s) => now - s.at <= SAMPLE_SPAN_MS).slice(-30);
  w.resetsAt = resetsAt;
  state[window] = w;
  return state;
}

/** Local summary from cache if fresh (shared by the status line and the VS Code extension), else rescan transcripts (incrementally) and refresh the cache. */
export function getLocalSummary(config: BurnrateConfig, home: string, now: Date): LocalSummary | undefined {
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
