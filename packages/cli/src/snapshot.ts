import type { StatuslineInput } from "@burnrate/adapter-claude-code";
import { readJson, writeJsonQuiet } from "./summary.js";

/**
 * The latest numbers Claude Code handed to the status line, saved so other surfaces
 * (the dashboard, a VS Code status bar item) can show real rate limits too.
 * Contains no message content: only ids, percentages, costs, and timestamps.
 */
export interface StatusSnapshot {
  version: 1;
  updatedAt: number;
  sessionId?: string;
  model?: { id?: string; display_name?: string };
  contextPercent?: number;
  sessionCostUsd?: number;
  /** Last rate limits seen from any session, kept even when a later session (e.g. API key) has none. */
  rateLimits?: StatuslineInput["rate_limits"];
  rateLimitsAt?: number;
  /** Sessions that recently ran the status line, newest first. */
  recentSessions: Array<{ id: string; lastSeen: number; version?: string }>;
}

const MAX_SESSIONS = 20;

export function updateSnapshot(
  prev: StatusSnapshot | undefined,
  input: StatuslineInput,
  now: number,
): StatusSnapshot {
  const next: StatusSnapshot = {
    version: 1,
    updatedAt: now,
    sessionId: input.session_id,
    model: input.model,
    contextPercent:
      typeof input.context_window?.used_percentage === "number"
        ? input.context_window.used_percentage
        : undefined,
    sessionCostUsd: input.cost?.total_cost_usd,
    rateLimits: prev?.rateLimits,
    rateLimitsAt: prev?.rateLimitsAt,
    recentSessions: prev?.recentSessions ?? [],
  };
  if (input.rate_limits && Object.keys(input.rate_limits).length) {
    next.rateLimits = input.rate_limits;
    next.rateLimitsAt = now;
  }
  if (input.session_id) {
    next.recentSessions = [
      { id: input.session_id, lastSeen: now, ...(input.version && { version: input.version }) },
      ...next.recentSessions.filter((s) => s.id !== input.session_id),
    ].slice(0, MAX_SESSIONS);
  }
  return next;
}

export function recordSnapshot(path: string, input: StatuslineInput, now: number): void {
  const prev = readJson<StatusSnapshot>(path);
  writeJsonQuiet(path, updateSnapshot(prev?.version === 1 ? prev : undefined, input, now));
}
