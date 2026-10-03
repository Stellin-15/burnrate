import {
  requestJson,
  type ProviderCostRow,
  type ProviderUsageRow,
  type RequestOptions,
} from "@burnrate/core";

/**
 * Client for Anthropic's Usage & Cost Admin API.
 * Docs: https://platform.claude.com/docs/en/manage-claude/usage-cost-api
 * Needs an Admin API key (sk-ant-admin01-...). Individual (non-organization) accounts can't create one.
 */
export const ANTHROPIC_API = "https://api.anthropic.com";

export interface AnthropicOptions {
  apiKey: string;
  from: Date;
  to: Date;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: RequestOptions["sleep"];
  userAgent?: string;
}

interface Page<T> {
  data: Array<{ starting_at: string; ending_at: string; results: T[] }>;
  has_more: boolean;
  next_page: string | null;
}

interface UsageResult {
  model: string | null;
  workspace_id: string | null;
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  output_tokens?: number;
}

interface CostResult {
  amount: string;
  currency: string;
  description: string | null;
  model: string | null;
  workspace_id: string | null;
  cost_type?: string | null;
  token_type?: string | null;
}

/** Days are the coarsest bucket; the API returns at most 31 per page. */
const DAYS_PER_PAGE = 31;

export function looksLikeAdminKey(key: string): boolean {
  return key.startsWith("sk-ant-admin");
}

function headers(o: AnthropicOptions): Record<string, string> {
  return {
    "x-api-key": o.apiKey,
    "anthropic-version": "2023-06-01",
    "user-agent": o.userAgent ?? "burnrate (https://github.com/Stellin-15/burnrate)",
  };
}

async function* pages<T>(
  path: string,
  params: URLSearchParams,
  o: AnthropicOptions,
): AsyncGenerator<Page<T>> {
  let page: string | null = null;
  do {
    const qs = new URLSearchParams(params);
    if (page) qs.set("page", page);
    const res: Page<T> = await requestJson<Page<T>>(`${o.baseUrl ?? ANTHROPIC_API}${path}?${qs}`, {
      headers: headers(o),
      fetch: o.fetch,
      sleep: o.sleep,
    });
    yield res;
    page = res.has_more ? res.next_page : null;
  } while (page);
}

function baseParams(o: AnthropicOptions): URLSearchParams {
  return new URLSearchParams({
    starting_at: o.from.toISOString(),
    ending_at: o.to.toISOString(),
    bucket_width: "1d",
    limit: String(DAYS_PER_PAGE),
  });
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Daily token usage per model and workspace. */
export async function fetchAnthropicUsage(o: AnthropicOptions): Promise<ProviderUsageRow[]> {
  const params = baseParams(o);
  params.append("group_by[]", "model");
  params.append("group_by[]", "workspace_id");
  const rows: ProviderUsageRow[] = [];
  for await (const page of pages<UsageResult>("/v1/organizations/usage_report/messages", params, o)) {
    for (const bucket of page.data) {
      for (const r of bucket.results) {
        rows.push({
          provider: "anthropic",
          bucketStart: bucket.starting_at,
          bucketEnd: bucket.ending_at,
          model: r.model ?? "(unknown)",
          scope: r.workspace_id ?? "",
          uncachedInputTokens: n(r.uncached_input_tokens),
          cacheReadTokens: n(r.cache_read_input_tokens),
          cacheWriteTokens: n(r.cache_creation?.ephemeral_5m_input_tokens),
          cacheWriteLongTokens: n(r.cache_creation?.ephemeral_1h_input_tokens),
          outputTokens: n(r.output_tokens),
        });
      }
    }
  }
  return rows;
}

/** Daily billed cost lines in USD, per description (model + token type) and workspace. */
export async function fetchAnthropicCosts(o: AnthropicOptions): Promise<ProviderCostRow[]> {
  const params = baseParams(o);
  params.append("group_by[]", "description");
  params.append("group_by[]", "workspace_id");
  const rows: ProviderCostRow[] = [];
  for await (const page of pages<CostResult>("/v1/organizations/cost_report", params, o)) {
    for (const bucket of page.data) {
      for (const r of bucket.results) {
        // "Cost amount in lowest currency units (e.g. cents) as a decimal string": "123.45" USD is $1.23.
        const cents = Number(r.amount);
        if (!Number.isFinite(cents)) continue;
        rows.push({
          provider: "anthropic",
          bucketStart: bucket.starting_at,
          bucketEnd: bucket.ending_at,
          scope: r.workspace_id ?? "",
          item: r.description ?? r.cost_type ?? "Total",
          ...(r.model && { model: r.model }),
          amountUsd: cents / 100,
        });
      }
    }
  }
  return rows;
}
