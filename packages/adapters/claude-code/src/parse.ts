import type { UsageEvent } from "@burnrate/core";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export interface ParseContext {
  /** Fallback project label when the line has no `cwd`. */
  projectDir?: string;
}

/**
 * Turn one transcript line into a UsageEvent, or undefined if the line isn't a billable
 * assistant response. Never throws: malformed JSON and unexpected shapes are skipped,
 * because a format change must not take down the status line.
 */
export function parseTranscriptLine(line: string, ctx: ParseContext = {}): UsageEvent | undefined {
  if (!line || line.charCodeAt(0) !== 123 /* { */) return undefined;
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!row || typeof row !== "object") return undefined;
  const message = row.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!message || !usage || typeof usage !== "object") return undefined;

  const model = str(message.model);
  const timestamp = str(row.timestamp);
  // "<synthetic>" marks locally generated messages (e.g. errors) that never hit the API.
  if (!model || model === "<synthetic>" || !timestamp || Number.isNaN(Date.parse(timestamp)))
    return undefined;

  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const cacheReadTokens = num(usage.cache_read_input_tokens);

  // Newer transcripts split cache writes by TTL; older ones only have the combined count (5m pricing).
  const split = usage.cache_creation as Record<string, unknown> | undefined;
  let cacheWriteTokens = num(usage.cache_creation_input_tokens);
  let cacheWrite1hTokens = 0;
  if (split && typeof split === "object") {
    const w5 = num(split.ephemeral_5m_input_tokens);
    const w1h = num(split.ephemeral_1h_input_tokens);
    if (w5 + w1h > 0) {
      cacheWriteTokens = w5;
      cacheWrite1hTokens = w1h;
    }
  }
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens + cacheWrite1hTokens === 0)
    return undefined;

  const messageId = str(message.id);
  const requestId = str(row.requestId);
  const id = messageId ? (requestId ? `${messageId}:${requestId}` : messageId) : str(row.uuid);
  if (!id) return undefined;

  const event: UsageEvent = {
    id: `claude-code:${id}`,
    timestamp: new Date(timestamp).toISOString(),
    tool: "claude-code",
    provider: "anthropic",
    model,
    inputTokens,
    outputTokens,
    source: "local-log",
  };
  const project = str(row.cwd) ?? ctx.projectDir;
  if (project) event.project = project;
  const sessionId = str(row.sessionId);
  if (sessionId) event.sessionId = sessionId;
  if (cacheReadTokens) event.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens) event.cacheWriteTokens = cacheWriteTokens;
  if (cacheWrite1hTokens) event.cacheWrite1hTokens = cacheWrite1hTokens;
  if (usage.speed === "fast") event.speed = "fast";
  if (typeof row.costUSD === "number") event.reportedCostUsd = row.costUSD;
  return event;
}

/**
 * Claude Code writes one line per content block of a streamed response, all with the same
 * message id and usually the same usage; later lines can carry the final output count.
 * Keep, per id, the line with the most output tokens.
 */
export function mergeDuplicate(existing: UsageEvent | undefined, next: UsageEvent): UsageEvent {
  if (!existing) return next;
  return next.outputTokens > existing.outputTokens ? next : existing;
}

/** Parse a whole transcript's text. Returns deduped events in file order. */
export function parseTranscript(text: string, ctx: ParseContext = {}): UsageEvent[] {
  const byId = new Map<string, UsageEvent>();
  for (const line of text.split(/\r?\n/)) {
    const e = parseTranscriptLine(line, ctx);
    if (e) byId.set(e.id, mergeDuplicate(byId.get(e.id), e));
  }
  return [...byId.values()];
}
