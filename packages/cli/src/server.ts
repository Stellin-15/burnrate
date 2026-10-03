import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import {
  budgetStatus,
  dayKey,
  emptyTotals,
  addToTotals,
  eventCost,
  repriceEvents,
  type BurnrateConfig,
  type UsageEvent,
  type UsageTotals,
} from "@burnrate/core";
import { findModelPricing, pricingTable } from "@burnrate/pricing";
import { projectName } from "./commands/report.js";
import { toCsv } from "./table.js";

export interface DashboardOptions {
  /** Returns current events. Called per request; do your own caching. */
  loadEvents: () => UsageEvent[];
  config: BurnrateConfig;
  /** Required on every /api request as `Authorization: Bearer <token>`. */
  token: string;
  /** Built dashboard (index.html + assets). If missing, only the API is served. */
  staticDir?: string;
  version: string;
  now?: () => Date;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** Same model, many spellings (dated ids, Bedrock ids…) -> one row. */
const modelKey = (m: string) => findModelPricing(m)?.id ?? m;
const modelLabel = (m: string) => findModelPricing(m)?.displayName.replace(/^Claude /, "") ?? m;

export interface UsageQuery {
  from?: Date;
  to?: Date;
  project?: string;
  model?: string;
}

export function parseQuery(params: URLSearchParams): UsageQuery {
  const date = (k: string) => {
    const v = params.get(k);
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  return {
    from: date("from"),
    to: date("to"),
    project: params.get("project") || undefined,
    model: params.get("model") || undefined,
  };
}

export function applyQuery(events: UsageEvent[], q: UsageQuery): UsageEvent[] {
  const from = q.from?.getTime() ?? -Infinity;
  const to = q.to?.getTime() ?? Infinity;
  return events.filter((e) => {
    const t = Date.parse(e.timestamp);
    return (
      t >= from &&
      t < to &&
      (!q.project || e.project === q.project) &&
      (!q.model || modelKey(e.model) === q.model)
    );
  });
}

const totalsRow = (key: string, label: string, t: UsageTotals) => ({ key, label, ...t });

function groupBy(events: UsageEvent[], keyOf: (e: UsageEvent) => string) {
  const map = new Map<string, UsageTotals>();
  for (const e of events) {
    const k = keyOf(e);
    let t = map.get(k);
    if (!t) map.set(k, (t = emptyTotals()));
    addToTotals(t, e);
  }
  return [...map].sort((a, b) => b[1].costUsd - a[1].costUsd || b[1].totalTokens - a[1].totalTokens);
}

/** Series shown in the daily chart: the top 4 models by cost, the rest folded into "Other". */
const MAX_SERIES = 4;

export function buildUsage(all: UsageEvent[], q: UsageQuery, config: BurnrateConfig, now: Date) {
  const events = applyQuery(all, q);
  const totals = emptyTotals();
  for (const e of events) addToTotals(totals, e);

  const models = groupBy(events, (e) => modelKey(e.model));
  const series = models.slice(0, MAX_SERIES).map(([k]) => k);
  const hasOther = models.length > MAX_SERIES;

  // One row per calendar day in range, including empty days, so gaps read as gaps.
  const firstTs = q.from?.getTime() ?? (events.length ? Date.parse(events[0]!.timestamp) : now.getTime());
  const lastTs = Math.min(q.to ? q.to.getTime() - 1 : now.getTime(), now.getTime());
  const byDay = new Map<
    string,
    { date: string; costUsd: number; requests: number; byModel: Record<string, number> }
  >();
  for (let d = new Date(firstTs); d.getTime() <= lastTs; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d);
    byDay.set(key, { date: key, costUsd: 0, requests: 0, byModel: {} });
    if (byDay.size > 400) break;
  }
  for (const e of events) {
    const key = dayKey(new Date(e.timestamp));
    let row = byDay.get(key);
    if (!row) byDay.set(key, (row = { date: key, costUsd: 0, requests: 0, byModel: {} }));
    const cost = eventCost(e) ?? 0;
    const m = modelKey(e.model);
    const s = series.includes(m) ? m : "other";
    row.costUsd += cost;
    row.requests++;
    row.byModel[s] = (row.byModel[s] ?? 0) + cost;
  }

  // What cache hits saved versus paying the full input price for the same tokens.
  let cacheSavingsUsd = 0;
  for (const e of events) {
    const p = findModelPricing(e.model);
    if (p && e.cacheReadTokens)
      cacheSavingsUsd += (e.cacheReadTokens * (p.prices.input - p.prices.cacheRead)) / 1e6;
  }

  const unpriced = [...new Set(events.map((e) => e.model))].filter((m) => !findModelPricing(m));
  return {
    range: { from: q.from?.toISOString(), to: q.to?.toISOString() },
    totals,
    cacheSavingsUsd,
    series: [
      ...series.map((id) => ({ id, label: modelLabel(id) })),
      ...(hasOther ? [{ id: "other", label: "Other models" }] : []),
    ],
    daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    models: models.map(([k, t]) => totalsRow(k, modelLabel(k), t)),
    projects: groupBy(events, (e) => e.project ?? "(unknown)").map(([k, t]) =>
      totalsRow(k, projectName(k), t),
    ),
    sessions: groupBy(events, (e) => e.sessionId ?? "(unknown)")
      .slice(0, 20)
      .map(([k, t]) => {
        // Events are time-ordered, so the first match is when the session started.
        const first = events.find((e) => (e.sessionId ?? "(unknown)") === k);
        return {
          ...totalsRow(k, first?.project ? projectName(first.project) : "(unknown project)", t),
          startedAt: first?.timestamp,
        };
      }),
    budgets: budgetStatus(all, config.budgets, now).map((b) => ({
      ...b,
      periodStart: b.periodStart.toISOString(),
      periodEnd: b.periodEnd.toISOString(),
    })),
    unpricedModels: unpriced,
  };
}

export function buildMeta(all: UsageEvent[], config: BurnrateConfig, version: string) {
  const projects = groupBy(all, (e) => e.project ?? "(unknown)").map(([k]) => ({
    id: k,
    label: projectName(k),
  }));
  const models = groupBy(all, (e) => modelKey(e.model)).map(([k]) => ({ id: k, label: modelLabel(k) }));
  return {
    version,
    currency: config.currency,
    budgets: config.budgets,
    pricingUpdatedAt: pricingTable.updatedAt,
    firstEventAt: all[0]?.timestamp,
    lastEventAt: all.at(-1)?.timestamp,
    eventCount: all.length,
    projects,
    models,
  };
}

const EXPORT_VIEWS = ["daily", "models", "projects", "sessions", "events"] as const;

function exportData(all: UsageEvent[], q: UsageQuery, view: string, config: BurnrateConfig, now: Date) {
  const headers = [
    "key",
    "label",
    "requests",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costUsd",
  ];
  if (view === "events") {
    const events = applyQuery(all, q);
    const rows = events.map((e) => {
      const t = addToTotals(emptyTotals(), e);
      return [
        e.timestamp,
        e.model,
        e.project ?? "",
        e.sessionId ?? "",
        e.inputTokens,
        e.outputTokens,
        t.cacheReadTokens,
        t.cacheWriteTokens,
        Number(t.costUsd.toFixed(6)),
      ];
    });
    return {
      headers: [
        "timestamp",
        "model",
        "project",
        "sessionId",
        "inputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
        "costUsd",
      ],
      rows,
      json: events,
    };
  }
  const usage = buildUsage(all, q, config, now);
  const list =
    view === "daily"
      ? usage.daily.map((d) => ({ key: d.date, label: d.date, requests: d.requests, costUsd: d.costUsd }))
      : usage[view as "models" | "projects" | "sessions"];
  const rows = list.map((r) =>
    headers.map((h) => {
      const v = (r as Record<string, unknown>)[h];
      return typeof v === "number" ? (h === "costUsd" ? Number(v.toFixed(6)) : v) : String(v ?? "");
    }),
  );
  return { headers, rows, json: list };
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type: string,
  extra: Record<string, string> = {},
) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  });
  res.end(body);
}
const json = (res: ServerResponse, status: number, value: unknown) =>
  send(res, status, JSON.stringify(value), MIME[".json"]!);

function tokenOk(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization ?? "";
  const given = Buffer.from(auth.startsWith("Bearer ") ? auth.slice(7) : "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function createDashboardServer(opts: DashboardOptions): Server {
  const now = opts.now ?? (() => new Date());
  const root = opts.staticDir ? resolve(opts.staticDir) : undefined;

  return createServer(async (req, res) => {
    try {
      const port = (req.socket.address() as { port?: number }).port;
      const host = (req.headers.host ?? "").toLowerCase();
      // Reject anything not addressed to us by a loopback name: blocks DNS-rebinding attacks.
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        return send(res, 421, "Misdirected request", "text/plain");
      if (req.method !== "GET" && req.method !== "HEAD")
        return send(res, 405, "Method not allowed", "text/plain", { allow: "GET" });

      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        if (!tokenOk(req, opts.token))
          return json(res, 401, {
            error: "Missing or wrong token. Open the link printed by `burnrate dashboard`.",
          });
        const q = parseQuery(url.searchParams);
        const all = opts.loadEvents();
        switch (url.pathname) {
          case "/api/meta":
            return json(res, 200, buildMeta(all, opts.config, opts.version));
          case "/api/usage":
            return json(res, 200, buildUsage(all, q, opts.config, now()));
          case "/api/pricing":
            return json(res, 200, pricingTable);
          case "/api/whatif": {
            const target = url.searchParams.get("target");
            if (!target) return json(res, 400, { error: "target model is required" });
            const r = repriceEvents(applyQuery(all, { ...q, model: undefined }), target, {
              onlyModel: url.searchParams.get("only") || undefined,
            });
            return r ? json(res, 200, r) : json(res, 404, { error: `No pricing for "${target}"` });
          }
          case "/api/export": {
            const view = url.searchParams.get("view") ?? "daily";
            const format = url.searchParams.get("format") === "json" ? "json" : "csv";
            if (!(EXPORT_VIEWS as readonly string[]).includes(view))
              return json(res, 400, { error: `view must be one of ${EXPORT_VIEWS.join(", ")}` });
            const data = exportData(all, q, view, opts.config, now());
            const name = `burnrate-${view}-${dayKey(now())}.${format}`;
            const disposition = { "content-disposition": `attachment; filename="${name}"` };
            return format === "json"
              ? send(res, 200, JSON.stringify(data.json, null, 2), MIME[".json"]!, disposition)
              : send(res, 200, toCsv(data.headers, data.rows), "text/csv; charset=utf-8", disposition);
          }
          default:
            return json(res, 404, { error: "Not found" });
        }
      }

      if (!root) return send(res, 404, "Dashboard assets not built. Run `pnpm build`.", "text/plain");
      // Static files. Unknown paths fall back to index.html (single-page app).
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
      let file = resolve(root, rel || "index.html");
      if (file !== root && !file.startsWith(root + sep)) return send(res, 403, "Forbidden", "text/plain");
      let body: Buffer;
      try {
        body = await readFile(file);
      } catch {
        file = join(root, "index.html");
        body = await readFile(file);
      }
      const type = MIME[extname(file)] ?? "application/octet-stream";
      const csp: Record<string, string> =
        extname(file) === ".html"
          ? {
              "content-security-policy":
                "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
            }
          : {};
      return send(res, 200, req.method === "HEAD" ? "" : body, type, csp);
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
