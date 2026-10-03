import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchOpenAICosts, fetchOpenAIUsage, looksLikeAdminKey, modelFromLineItem } from "./index.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const KEY = "sk-admin-SECRETSECRETSECRET";
const from = new Date("2026-09-01T00:00:00Z");
const to = new Date("2026-09-02T00:00:00Z");

function fakeFetch(bodies: string[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    return new Response(bodies.shift()!, { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe("fetchOpenAIUsage", () => {
  it("sends unix-second ranges with bearer auth", async () => {
    const f = fakeFetch([fixture("usage.json")]);
    await fetchOpenAIUsage({ apiKey: KEY, from, to, fetch: f.fn });
    const url = new URL(f.calls[0]!.url);
    expect(url.pathname).toBe("/v1/organization/usage/completions");
    expect(url.searchParams.get("start_time")).toBe(String(from.getTime() / 1000));
    expect(url.searchParams.getAll("group_by")).toEqual(["model", "project_id"]);
    expect(f.calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("splits OpenAI's inclusive input_tokens into uncached, cached, and cache writes", async () => {
    const rows = await fetchOpenAIUsage({
      apiKey: KEY,
      from,
      to,
      fetch: fakeFetch([fixture("usage.json")]).fn,
    });
    // 1,000,000 input = 600,000 cached + 50,000 cache write + 350,000 uncached
    expect(rows[0]).toEqual({
      provider: "openai",
      bucketStart: "2026-09-01T00:00:00.000Z",
      bucketEnd: "2026-09-02T00:00:00.000Z",
      model: "gpt-5-2025-08-07",
      scope: "proj_abc",
      uncachedInputTokens: 350000,
      cacheReadTokens: 600000,
      cacheWriteTokens: 50000,
      cacheWriteLongTokens: 0,
      outputTokens: 200000,
      requests: 420,
    });
    expect(rows[1]).toMatchObject({
      model: "gpt-5-mini",
      scope: "",
      uncachedInputTokens: 4000,
      cacheReadTokens: 1000,
    });
  });
});

describe("fetchOpenAICosts", () => {
  it("keeps USD line items, reads the model from the line item, skips other currencies", async () => {
    const f = fakeFetch([fixture("costs.json")]);
    const rows = await fetchOpenAICosts({ apiKey: KEY, from, to, fetch: f.fn });
    expect(new URL(f.calls[0]!.url).searchParams.get("limit")).toBe("180");
    expect(rows.map((r) => [r.item, r.model, r.amountUsd])).toEqual([
      ["gpt-5-2025-08-07, input", "gpt-5-2025-08-07", 4.25],
      ["Web search tool calls", undefined, 0.5],
    ]);
  });

  it.each([
    ["gpt-5-2025-08-07, input", "gpt-5-2025-08-07"],
    ["gpt-4o-mini, cached input", "gpt-4o-mini"],
    ["Web search tool calls", undefined],
  ])("modelFromLineItem(%s)", (item, model) => {
    expect(modelFromLineItem(item)).toBe(model);
  });

  it("recognizes admin keys", () => {
    expect(looksLikeAdminKey(KEY)).toBe(true);
    expect(looksLikeAdminKey("sk-proj-abc")).toBe(false);
  });
});
