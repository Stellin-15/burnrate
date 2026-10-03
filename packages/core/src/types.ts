/** One model request, normalized across every tool and provider BurnRate understands. */
export interface UsageEvent {
  /** Stable id used for dedupe. Adapters must produce the same id when they see the same request twice. */
  id: string;
  /** ISO 8601 timestamp of the request. */
  timestamp: string;
  /** Tool that made the request, e.g. "claude-code". */
  tool: string;
  /** Model provider, e.g. "anthropic". */
  provider: string;
  model: string;
  /** Human-readable project name or path. */
  project?: string;
  sessionId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  /** Cache writes billed at the 5-minute rate. */
  cacheWriteTokens?: number;
  /** Cache writes billed at the 1-hour rate. */
  cacheWrite1hTokens?: number;
  /** "fast" when the request ran in fast mode (premium pricing). */
  speed?: "standard" | "fast";
  /** Cost reported by the source itself, if any. BurnRate still computes its own for consistency. */
  reportedCostUsd?: number;
  source: "local-log" | "provider-api" | "statusline";
}

/** An adapter turns one tool's or provider's data into UsageEvents. */
export interface Adapter {
  id: string;
  /** Is this tool installed / does it have data on this machine? */
  detect(): Promise<boolean>;
  /** Stream events with timestamp >= since. Must never throw on malformed input; skip it instead. */
  readEvents(since: Date): AsyncIterable<UsageEvent>;
  /** Optional live updates. Returns an unsubscribe function. */
  watch?(onEvent: (e: UsageEvent) => void): () => void;
}
