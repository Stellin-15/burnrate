import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type UsageEvent } from "@burnrate/core";
import { createDashboardServer } from "./server.js";

const M = 1_000_000;
let n = 0;
const ev = (iso: string, model: string, input: number, project = "/work/web"): UsageEvent => ({
  id: `e${n++}`,
  timestamp: iso,
  tool: "claude-code",
  provider: "anthropic",
  model,
  inputTokens: input,
  outputTokens: 0,
  project,
  sessionId: "sess-abcdef123",
  source: "local-log",
});

// Haiku 4.5 at 1M input = $1; Opus 5.5 at 1M input = $4.
const events = [
  ev("2026-10-01T10:00:00Z", "claude-haiku-4-5-20251001", M),
  ev("2026-10-01T11:00:00Z", "claude-haiku-4-5", M, "/work/api"),
  ev("2026-10-03T10:00:00Z", "claude-opus-5-5", M),
  ev("2026-10-03T10:30:00Z", "mystery-model", M),
];

const TOKEN = "test-token-123";
const staticDir = mkdtempSync(join(tmpdir(), "burnrate-static-"));
mkdirSync(join(staticDir, "assets"));
writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>BurnRate</title>");
writeFileSync(join(staticDir, "assets", "app.js"), "console.log(1)");
writeFileSync(join(staticDir, "..", "secret.txt"), "nope");

const server = createDashboardServer({
  loadEvents: () => events,
  config: { ...structuredClone(DEFAULT_CONFIG), budgets: { monthly: 10 } },
  token: TOKEN,
  staticDir,
  version: "0.0.0-test",
  now: () => new Date("2026-10-03T12:00:00Z"),
});
let base = "";

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are checked field by field
const getJson = async (path: string): Promise<any> => (await api(path)).json();
const api = (path: string, token = TOKEN) =>
  fetch(base + path, { headers: { authorization: `Bearer ${token}` } });

/** Raw request so we can forge the Host header (fetch won't let us). */
function rawGet(path: string, host: string): Promise<number> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("security", () => {
  it("rejects API calls without the right token", async () => {
    expect((await fetch(base + "/api/meta")).status).toBe(401);
    expect((await api("/api/meta", "wrong")).status).toBe(401);
    expect((await api("/api/meta")).status).toBe(200);
  });

  it("rejects requests addressed to a foreign host (DNS rebinding)", async () => {
    expect(await rawGet("/api/meta", "evil.example:80")).toBe(421);
    expect(await rawGet("/", "attacker.test")).toBe(421);
  });

  it("only allows GET", async () => {
    const res = await fetch(base + "/api/meta", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(405);
  });

  it("never serves files outside the static dir", async () => {
    const res = await fetch(base + "/..%2Fsecret.txt");
    expect(await res.text()).not.toContain("nope");
  });

  it("sends no CORS headers, so other sites can't read responses", async () => {
    const res = await api("/api/meta");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("static files", () => {
  it("serves index.html with a strict CSP and falls back to it for unknown paths", async () => {
    const res = await fetch(base + "/");
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'self'/);
    expect(await (await fetch(base + "/calculator")).text()).toContain("<title>BurnRate</title>");
  });

  it("serves assets with the right type", async () => {
    const res = await fetch(base + "/assets/app.js");
    expect(res.headers.get("content-type")).toMatch(/javascript/);
  });
});

describe("/api/usage", () => {
  it("totals, merges model spellings, and fills empty days", async () => {
    const u = await getJson("/api/usage?from=2026-10-01T00:00:00Z");
    expect(u.totals.costUsd).toBeCloseTo(6, 6); // $1 + $1 + $4, mystery unpriced
    expect(u.totals.unpricedRequests).toBe(1);
    expect(u.unpricedModels).toEqual(["mystery-model"]);
    expect(u.models.map((m: { key: string }) => m.key)).toEqual([
      "claude-opus-5-5",
      "claude-haiku-4-5",
      "mystery-model",
    ]);
    expect(u.models[0].label).toBe("Opus 5.5");
    expect(u.daily.length).toBeGreaterThanOrEqual(3); // includes the empty middle day
    expect(u.projects.map((p: { label: string }) => p.label)).toEqual(["web", "api"]);
  });

  it("filters by project and model", async () => {
    const byProject = await getJson(`/api/usage?project=${encodeURIComponent("/work/api")}`);
    expect(byProject.totals.requests).toBe(1);
    const byModel = await getJson("/api/usage?model=claude-haiku-4-5");
    expect(byModel.totals.requests).toBe(2);
  });

  it("reports budget status against all usage", async () => {
    const u = await getJson("/api/usage?from=2026-10-03T00:00:00Z");
    expect(u.budgets[0]).toMatchObject({ period: "monthly", limitUsd: 10, spentUsd: 6 });
  });
});

describe("/api/whatif", () => {
  it("re-prices history on another model", async () => {
    const r = await getJson("/api/whatif?target=claude-sonnet-5-5");
    expect(r.actualUsd).toBeCloseTo(6, 6);
    expect(r.repricedUsd).toBeCloseTo(6, 6); // 3M input tokens * $2
    expect((await api("/api/whatif?target=nope")).status).toBe(404);
    expect((await api("/api/whatif")).status).toBe(400);
  });
});

describe("/api/export", () => {
  it("downloads CSV with a filename", async () => {
    const res = await api("/api/export?view=models&format=csv");
    expect(res.headers.get("content-disposition")).toMatch(/burnrate-models-2026-10-03\.csv/);
    const lines = (await res.text()).split("\n");
    expect(lines[0]).toBe(
      "key,label,requests,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,costUsd",
    );
    expect(lines[1]).toMatch(/^claude-opus-5-5,Opus 5.5,1,1000000,0,0,0,4$/);
  });

  it("downloads raw events as JSON", async () => {
    const data = await getJson("/api/export?view=events&format=json");
    expect(data).toHaveLength(4);
  });

  it("rejects unknown views", async () => {
    expect((await api("/api/export?view=secrets")).status).toBe(400);
  });
});

describe("/api/usage details", () => {
  it("labels sessions by project and start time, and reports cache savings", async () => {
    const u = await getJson("/api/usage");
    expect(u.sessions[0]).toMatchObject({ label: "web", startedAt: "2026-10-01T10:00:00Z" });
    expect(u.cacheSavingsUsd).toBe(0); // no cache reads in these events
  });
});
