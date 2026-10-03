import {
  requestJson,
  type ProviderCostRow,
  type ProviderUsageRow,
  type RequestOptions,
} from "@burnrate/core";

/**
 * Client for OpenAI's organization Usage and Costs APIs.
 * Source of truth: the official OpenAPI spec (github.com/openai/openai-openapi), paths
 * /organization/usage/completions and /organization/costs. Needs an Admin key (sk-admin-...).
 */
export const OPENAI_API = "https://api.openai.com/v1";

export interface OpenAIOptions {
  apiKey: string;
  from: Date;
  to: Date;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: RequestOptions["sleep"];
}

interface Page<T> {
  data: Array<{ start_time: number; end_time: number; results: T[] }>;
  has_more: boolean;
  next_page: string | null;
}

interface CompletionsResult {
  model?: string | null;
  project_id?: string | null;
  /** Includes cached and cache-write tokens. */
  input_tokens?: number;
  input_cached_tokens?: number;
  input_cache_write_tokens?: number;
  input_cache_write_12h_tokens?: number;
  input_uncached_tokens?: number;
  output_tokens?: number;
  num_model_requests?: number;
}

interface CostsResult {
  amount?: { value?: number; currency?: string };
  line_item?: string | null;
  project_id?: string | null;
}

export function looksLikeAdminKey(key: string): boolean {
  return key.startsWith("sk-admin-");
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

async function* pages<T>(path: string, params: URLSearchParams, o: OpenAIOptions): AsyncGenerator<Page<T>> {
  let page: string | null = null;
  do {
    const qs = new URLSearchParams(params);
    if (page) qs.set("page", page);
    const res: Page<T> = await requestJson<Page<T>>(`${o.baseUrl ?? OPENAI_API}${path}?${qs}`, {
      headers: { authorization: `Bearer ${o.apiKey}` },
      fetch: o.fetch,
      sleep: o.sleep,
    });
    yield res;
    page = res.has_more ? res.next_page : null;
  } while (page);
}

function baseParams(o: OpenAIOptions, limit: number): URLSearchParams {
  return new URLSearchParams({
    start_time: String(Math.floor(o.from.getTime() / 1000)),
    end_time: String(Math.floor(o.to.getTime() / 1000)),
    bucket_width: "1d",
    limit: String(limit),
  });
}

/**
 * Daily completions usage per model and project. OpenAI's `input_tokens` already includes cached
 * and cache-write tokens, so it's split back out here to match BurnRate's "uncached input" column.
 */
export async function fetchOpenAIUsage(o: OpenAIOptions): Promise<ProviderUsageRow[]> {
  const params = baseParams(o, 31);
  params.append("group_by", "model");
  params.append("group_by", "project_id");
  const rows: ProviderUsageRow[] = [];
  for await (const page of pages<CompletionsResult>("/organization/usage/completions", params, o)) {
    for (const bucket of page.data) {
      for (const r of bucket.results) {
        const cacheRead = n(r.input_cached_tokens);
        const write = n(r.input_cache_write_tokens);
        const writeLong = n(r.input_cache_write_12h_tokens);
        const uncached =
          r.input_uncached_tokens !== undefined
            ? n(r.input_uncached_tokens)
            : Math.max(0, n(r.input_tokens) - cacheRead - write - writeLong);
        rows.push({
          provider: "openai",
          bucketStart: iso(bucket.start_time),
          bucketEnd: iso(bucket.end_time),
          model: r.model ?? "(unknown)",
          scope: r.project_id ?? "",
          uncachedInputTokens: uncached,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: write,
          cacheWriteLongTokens: writeLong,
          outputTokens: n(r.output_tokens),
          requests: n(r.num_model_requests),
        });
      }
    }
  }
  return rows;
}

/** "gpt-5-2025-08-07, input" -> "gpt-5-2025-08-07". Undefined for non-model line items. */
export function modelFromLineItem(item: string): string | undefined {
  const m = /^([a-z0-9][\w.:-]*?),\s/i.exec(item);
  return m?.[1];
}

/** Daily billed costs per line item and project. Non-USD amounts are skipped (BurnRate reports USD). */
export async function fetchOpenAICosts(o: OpenAIOptions): Promise<ProviderCostRow[]> {
  const params = baseParams(o, 180);
  params.append("group_by", "line_item");
  params.append("group_by", "project_id");
  const rows: ProviderCostRow[] = [];
  for await (const page of pages<CostsResult>("/organization/costs", params, o)) {
    for (const bucket of page.data) {
      for (const r of bucket.results) {
        if ((r.amount?.currency ?? "usd").toLowerCase() !== "usd") continue;
        const item = r.line_item ?? "Total";
        const model = r.line_item ? modelFromLineItem(r.line_item) : undefined;
        rows.push({
          provider: "openai",
          bucketStart: iso(bucket.start_time),
          bucketEnd: iso(bucket.end_time),
          scope: r.project_id ?? "",
          item,
          ...(model && { model }),
          amountUsd: n(r.amount?.value),
        });
      }
    }
  }
  return rows;
}
