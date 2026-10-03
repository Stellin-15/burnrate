import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { BurnrateStore } from "@burnrate/store";
import { maskKey, resolveKey, type Keychain } from "./keys.js";
import { syncProvider, syncWindowStart } from "./sync.js";
import { explainProviderError } from "./commands/keys.js";
import { ProviderError } from "@burnrate/core";

const fixture = (pkg: string, name: string) =>
  readFileSync(new URL(`../../adapters/${pkg}/fixtures/${name}`, import.meta.url), "utf8");

const memoryKeychain = (initial: Record<string, string> = {}): Keychain => {
  const m = new Map(Object.entries(initial));
  return { get: (p) => m.get(p), set: (p, k) => void m.set(p, k), delete: (p) => m.delete(p) };
};

describe("keys", () => {
  it("prefers the environment variable over the keychain", () => {
    const kc = memoryKeychain({ anthropic: "sk-ant-admin01-fromkeychain" });
    expect(resolveKey("anthropic", kc, { ANTHROPIC_ADMIN_KEY: "sk-ant-admin01-fromenv" })).toEqual({
      key: "sk-ant-admin01-fromenv",
      source: "env",
    });
    expect(resolveKey("anthropic", kc, {})?.source).toBe("keychain");
    expect(resolveKey("openai", kc, {})).toBeUndefined();
  });

  it("treats a throwing keychain as no key", () => {
    const broken: Keychain = {
      get: () => {
        throw new Error("locked");
      },
      set: () => {},
      delete: () => false,
    };
    expect(resolveKey("anthropic", broken, {})).toBeUndefined();
  });

  it("masks keys so they can be recognized but not reused", () => {
    expect(maskKey("sk-ant-admin01-abcdefghijklmnopWXYZ")).toBe("sk-ant-…WXYZ");
    expect(maskKey("sk-admin-abcdefghijklmnop1234")).toBe("sk-admin-…1234");
    expect(maskKey("short")).toBe("…");
  });

  it("explains auth failures with what to do next", () => {
    const msg = explainProviderError("anthropic", new ProviderError("401 Unauthorized", 401));
    expect(msg).toMatch(/Admin key/);
    expect(msg).toMatch(/platform\.claude\.com/);
  });
});

describe("syncProvider", () => {
  const stores: BurnrateStore[] = [];
  afterEach(() => stores.splice(0).forEach((s) => s.close()));

  it("backfills usage and costs into the store and records the sync", async () => {
    const store = new BurnrateStore(":memory:");
    stores.push(store);
    const bodies: Record<string, string[]> = {
      usage_report: [
        fixture("anthropic-api", "usage-page-1.json"),
        fixture("anthropic-api", "usage-page-2.json"),
      ],
      cost_report: [fixture("anthropic-api", "cost.json")],
    };
    const fakeFetch = (async (url: string) => {
      const kind = url.includes("cost_report") ? "cost_report" : "usage_report";
      return new Response(bodies[kind]!.shift()!, { status: 200 });
    }) as typeof fetch;
    const now = new Date("2026-09-30T12:00:00Z");

    const r = await syncProvider("anthropic", "sk-ant-admin01-test", store, {
      days: 30,
      now,
      fetch: fakeFetch,
    });
    expect(r.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(r.usageRows).toBe(2);
    expect(r.reportedUsd).toBeCloseTo(7.2345, 10);
    expect(store.providerUsage("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z")).toHaveLength(2);
    expect(store.providerCosts("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z")).toHaveLength(2);
    expect(store.syncState()).toEqual([{ provider: "anthropic", lastSyncedAt: now.getTime() }]);
  });

  it("records a failed sync without storing anything", async () => {
    const store = new BurnrateStore(":memory:");
    stores.push(store);
    const fakeFetch = (async () =>
      new Response('{"error":{"message":"bad key"}}', { status: 401 })) as typeof fetch;
    await expect(syncProvider("openai", "sk-admin-x", store, { fetch: fakeFetch })).rejects.toThrow(/401/);
    expect(store.syncState()[0]).toMatchObject({
      provider: "openai",
      lastError: expect.stringMatching(/401/),
    });
  });

  it("windows start at UTC midnight", () => {
    expect(syncWindowStart(1, new Date("2026-09-30T23:30:00Z")).toISOString()).toBe(
      "2026-09-30T00:00:00.000Z",
    );
  });
});
