import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProviderError, redactSecrets } from "@burnrate/core";
import { fetchAnthropicCosts, fetchAnthropicUsage, looksLikeAdminKey } from "./index.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const KEY = "sk-ant-admin01-SECRETSECRETSECRET";
const from = new Date("2026-09-01T00:00:00Z");
const to = new Date("2026-09-03T00:00:00Z");

/** Fake fetch that serves queued responses and records requests. */
function fakeFetch(responses: Array<{ status?: number; body: string; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    const r = responses.shift();
    if (!r) throw new Error("no more fake responses");
    return new Response(r.body, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return { fn, calls };
}
const noSleep = async () => {};

describe("fetchAnthropicUsage", () => {
  it("follows pagination and maps every token field", async () => {
    const f = fakeFetch([{ body: fixture("usage-page-1.json") }, { body: fixture("usage-page-2.json") }]);
    const rows = await fetchAnthropicUsage({ apiKey: KEY, from, to, fetch: f.fn });

    expect(f.calls).toHaveLength(2);
    const first = new URL(f.calls[0]!.url);
    expect(first.pathname).toBe("/v1/organizations/usage_report/messages");
    expect(first.searchParams.get("bucket_width")).toBe("1d");
    expect(first.searchParams.getAll("group_by[]")).toEqual(["model", "workspace_id"]);
    expect(f.calls[0]!.headers["x-api-key"]).toBe(KEY);
    expect(f.calls[0]!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(new URL(f.calls[1]!.url).searchParams.get("page")).toBe("page_2");

    expect(rows).toEqual([
      {
        provider: "anthropic",
        bucketStart: "2026-09-01T00:00:00Z",
        bucketEnd: "2026-09-02T00:00:00Z",
        model: "claude-opus-5-5",
        scope: "",
        uncachedInputTokens: 12000,
        cacheReadTokens: 5000000,
        cacheWriteTokens: 10000,
        cacheWriteLongTokens: 200000,
        outputTokens: 300000,
      },
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        scope: "wrkspc_01Example",
        outputTokens: 1000000,
      }),
    ]);
  });

  it("retries on 429 using Retry-After, then succeeds", async () => {
    const waits: number[] = [];
    const f = fakeFetch([
      { status: 429, body: '{"error":{"message":"rate limited"}}', headers: { "retry-after": "2" } },
      { body: fixture("usage-page-2.json") },
    ]);
    await fetchAnthropicUsage({
      apiKey: KEY,
      from,
      to,
      fetch: f.fn,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(waits).toEqual([2000]);
  });

  it("fails fast on 401 with a clear message and no key in it", async () => {
    const f = fakeFetch([{ status: 401, body: `{"error":{"message":"invalid x-api-key ${KEY}"}}` }]);
    const err = await fetchAnthropicUsage({ apiKey: KEY, from, to, fetch: f.fn, sleep: noSleep }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
    expect(err.message).not.toContain("SECRET");
    expect(f.calls).toHaveLength(1);
  });
});

describe("fetchAnthropicCosts", () => {
  it("converts cents strings to dollars", async () => {
    const f = fakeFetch([{ body: fixture("cost.json") }]);
    const rows = await fetchAnthropicCosts({ apiKey: KEY, from, to, fetch: f.fn });
    expect(new URL(f.calls[0]!.url).pathname).toBe("/v1/organizations/cost_report");
    expect(rows.map((r) => [r.item, r.model, r.amountUsd, r.scope])).toEqual([
      ["Claude Opus 5.5 Usage - Output Tokens", "claude-opus-5-5", 6, ""],
      ["Web Search Usage", undefined, 1.2345, "wrkspc_01Example"],
    ]);
  });
});

describe("keys", () => {
  it("recognizes admin keys and redacts them anywhere", () => {
    expect(looksLikeAdminKey(KEY)).toBe(true);
    expect(looksLikeAdminKey("sk-ant-api03-xyz")).toBe(false);
    expect(redactSecrets(`key=${KEY} and "x-api-key": "${KEY}"`)).not.toContain("SECRET");
    expect(redactSecrets("Authorization: Bearer sk-admin-abcdefghijklmnopqrstuvwxyz")).not.toContain(
      "abcdefgh",
    );
  });
});
