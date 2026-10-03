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

/** One time bucket of usage as a provider's own API reports it. */
export interface ProviderUsageRow {
  provider: ProviderId;
  /** ISO start of the bucket (UTC). */
  bucketStart: string;
  bucketEnd: string;
  model: string;
  /** Workspace (Anthropic) or project (OpenAI) id; "" for the default/unknown. */
  scope: string;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  /** Short-lived cache writes (Anthropic 5m, OpenAI 30m). */
  cacheWriteTokens: number;
  /** Long-lived cache writes (Anthropic 1h, OpenAI 12h). */
  cacheWriteLongTokens: number;
  outputTokens: number;
  /** Request count when the provider reports it (OpenAI does; Anthropic doesn't). */
  requests?: number;
}

/** One cost line as a provider bills it, in USD. */
export interface ProviderCostRow {
  provider: ProviderId;
  bucketStart: string;
  bucketEnd: string;
  scope: string;
  /** Provider's own label, e.g. "Claude Opus 5 Usage - Input Tokens" or "gpt-5, input". */
  item: string;
  model?: string;
  amountUsd: number;
}

/** Providers whose usage/cost APIs BurnRate can sync. */
export type ProviderId = "anthropic" | "openai";
