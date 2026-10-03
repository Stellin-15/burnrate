import {
  computeBlocks,
  emptyTotals,
  formatMoney,
  formatTokens,
  groupEvents,
  loadConfig,
  sumEvents,
  type GroupBy,
  type UsageEvent,
  type UsageTotals,
} from "@burnrate/core";
import { findModelPricing, pricingTable } from "@burnrate/pricing";
import { claudeConfigDirs, loadClaudeCodeEvents } from "@burnrate/adapter-claude-code";
import { colorEnabled, paintAnsi, paintNone } from "../ansi.js";
import { renderTable, toCsv } from "../table.js";

export const REPORT_VIEWS = [
  "daily",
  "weekly",
  "monthly",
  "models",
  "projects",
  "sessions",
  "blocks",
] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

const GROUP: Record<Exclude<ReportView, "blocks">, GroupBy> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  models: "model",
  projects: "project",
  sessions: "session",
};

export interface ReportArgs {
  view: ReportView;
  since?: string;
  until?: string;
  project?: string;
  model?: string;
  format: "table" | "json" | "csv";
  limit?: number;
}

/** Parse YYYY-MM-DD as local midnight, or a relative "30d" / "12h". */
export function parseDateArg(s: string, now = new Date()): Date | undefined {
  const rel = /^(\d+)([dh])$/.exec(s);
  if (rel) return new Date(now.getTime() - Number(rel[1]) * (rel[2] === "d" ? 86_400_000 : 3_600_000));
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  return undefined;
}

/** Last path segment, for both / and \ separators. */
export function projectName(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? p;
}

function defaultSince(view: ReportView, now: Date): Date {
  const days = view === "monthly" ? 365 : view === "weekly" ? 84 : 30;
  return new Date(now.getTime() - days * 86_400_000);
}

export function filterEvents(
  events: UsageEvent[],
  args: Pick<ReportArgs, "until" | "project" | "model">,
): UsageEvent[] {
  const until = args.until ? parseDateArg(args.until) : undefined;
  // --until is inclusive of that whole day.
  const untilMs = until
    ? until.getTime() + (/^\d{4}-\d{2}-\d{2}$/.test(args.until!) ? 86_400_000 : 0)
    : Infinity;
  const proj = args.project?.toLowerCase();
  const model = args.model?.toLowerCase();
  return events.filter(
    (e) =>
      Date.parse(e.timestamp) < untilMs &&
      (!proj || (e.project ?? "").toLowerCase().includes(proj)) &&
      (!model || e.model.toLowerCase().includes(model)),
  );
}

const TOKEN_HEADERS = ["Requests", "Input", "Output", "Cache read", "Cache write", "Cost"];
const tokenCells = (t: UsageTotals, money: (n: number) => string) => [
  String(t.requests),
  formatTokens(t.inputTokens),
  formatTokens(t.outputTokens),
  formatTokens(t.cacheReadTokens),
  formatTokens(t.cacheWriteTokens),
  money(t.costUsd) + (t.unpricedRequests ? "*" : ""),
];
const rawCells = (t: UsageTotals) => [
  t.requests,
  t.inputTokens,
  t.outputTokens,
  t.cacheReadTokens,
  t.cacheWriteTokens,
  Number(t.costUsd.toFixed(6)),
];

export interface ReportResult {
  /** First column, then extraHeaders, then the token/cost columns. */
  headers: string[];
  /** Columns between the label and the token columns (e.g. block status, session start). */
  extraHeaders: string[];
  rows: Array<{ key: string; label: string; extra?: string[]; totals: UsageTotals }>;
  totals: UsageTotals;
}

/** Sum several rows' totals, e.g. for an "N more" line under a --limit-ed table. */
export function mergeTotals(list: UsageTotals[]): UsageTotals {
  const t = emptyTotals();
  for (const x of list) {
    t.requests += x.requests;
    t.inputTokens += x.inputTokens;
    t.outputTokens += x.outputTokens;
    t.cacheReadTokens += x.cacheReadTokens;
    t.cacheWriteTokens += x.cacheWriteTokens;
    t.totalTokens += x.totalTokens;
    t.costUsd += x.costUsd;
    t.unpricedRequests += x.unpricedRequests;
    for (const m of x.models) if (!t.models.includes(m)) t.models.push(m);
  }
  return t;
}

const SESSION_START = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

export function buildReport(events: UsageEvent[], view: ReportView, now = new Date()): ReportResult {
  const totals = sumEvents(events);
  if (view === "blocks") {
    const blocks = computeBlocks(events);
    return {
      headers: ["Block start", "Status", ...TOKEN_HEADERS],
      extraHeaders: ["Status"],
      rows: blocks.map((b) => ({
        key: b.start.toISOString(),
        label: b.start.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
        extra: [
          now < b.end
            ? "active"
            : `${Math.round((b.lastActivity.getTime() - b.firstActivity.getTime()) / 60_000)}m`,
        ],
        totals: b.totals,
      })),
      totals,
    };
  }
  const by = GROUP[view];
  const header = {
    day: "Date",
    week: "Week of",
    month: "Month",
    model: "Model",
    project: "Project",
    session: "Session",
    tool: "Tool",
  }[by];
  if (by === "session") {
    // Events are time-ordered, so the first one seen per session is when it started.
    const firstOf = new Map<string, UsageEvent>();
    for (const e of events) {
      const k = e.sessionId ?? "(unknown)";
      if (!firstOf.has(k)) firstOf.set(k, e);
    }
    return {
      headers: [header, "Started", "Project", ...TOKEN_HEADERS],
      extraHeaders: ["Started", "Project"],
      rows: groupEvents(events, by).map((r) => {
        const first = firstOf.get(r.key);
        return {
          key: r.key,
          label: r.key.slice(0, 8),
          extra: [
            first ? SESSION_START.format(new Date(first.timestamp)) : "",
            first?.project ? projectName(first.project) : "",
          ],
          totals: r.totals,
        };
      }),
      totals,
    };
  }
  // Merge spellings of the same model (dated snapshots, Bedrock ids) into one row, like the dashboard.
  const grouped =
    by === "model" ? events.map((e) => ({ ...e, model: findModelPricing(e.model)?.id ?? e.model })) : events;
  return {
    headers: [header, ...TOKEN_HEADERS],
    extraHeaders: [],
    rows: groupEvents(grouped, by).map((r) => ({
      key: r.key,
      label: by === "project" ? projectName(r.key) : r.key,
      totals: r.totals,
    })),
    totals,
  };
}

export async function runReport(args: ReportArgs): Promise<number> {
  const { config, warnings } = loadConfig();
  for (const w of warnings) console.error(`config: ${w}`);
  const now = new Date();
  const since = args.since ? parseDateArg(args.since, now) : defaultSince(args.view, now);
  if (args.since && !since) {
    console.error(`Invalid --since "${args.since}". Use YYYY-MM-DD or a relative value like 7d or 12h.`);
    return 2;
  }
  if (args.until && !parseDateArg(args.until, now)) {
    console.error(`Invalid --until "${args.until}". Use YYYY-MM-DD or a relative value like 7d.`);
    return 2;
  }

  const dirs = claudeConfigDirs(config.claudeDirs);
  if (!dirs.length) {
    console.error(
      "No Claude Code data found. Looked for ~/.claude/projects (and CLAUDE_CONFIG_DIR). Run `burnrate doctor` for details.",
    );
    return 1;
  }
  const events = filterEvents(loadClaudeCodeEvents({ dirs, since }), args);
  const report = buildReport(events, args.view, now);
  // --limit keeps the most recent rows for time views and the top rows (by cost) otherwise.
  const timeView =
    args.view === "daily" || args.view === "weekly" || args.view === "monthly" || args.view === "blocks";
  const rows = !args.limit
    ? report.rows
    : timeView
      ? report.rows.slice(-args.limit)
      : report.rows.slice(0, args.limit);
  const omitted = report.rows.filter((r) => !rows.includes(r));

  if (args.format === "json") {
    console.log(
      JSON.stringify(
        {
          view: args.view,
          since: since?.toISOString(),
          pricingUpdatedAt: pricingTable.updatedAt,
          rows: rows.map((r) => ({
            key: r.key,
            ...Object.fromEntries(report.extraHeaders.map((h, i) => [h.toLowerCase(), r.extra?.[i] ?? ""])),
            ...r.totals,
          })),
          omittedRows: omitted.length,
          totals: report.totals,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (args.format === "csv") {
    const headers = [
      report.headers[0]!,
      ...report.extraHeaders,
      "Requests",
      "Input",
      "Output",
      "CacheRead",
      "CacheWrite",
      "CostUSD",
    ];
    console.log(
      toCsv(
        headers,
        rows.map((r) => [r.key, ...(r.extra ?? []), ...rawCells(r.totals)]),
      ),
    );
    return 0;
  }

  const paint = colorEnabled() ? paintAnsi : paintNone;
  const money = (n: number) => formatMoney(n, config.currency);
  if (!rows.length) {
    console.log(`No Claude Code usage found since ${since?.toLocaleDateString()}.`);
    return 0;
  }
  const blanks = report.extraHeaders.map(() => "");
  const body = rows.map((r) => [r.label, ...(r.extra ?? blanks), ...tokenCells(r.totals, money)]);
  // Keep the visible rows adding up to the Total line when --limit hides some.
  if (omitted.length) {
    const label = `${omitted.length} ${timeView ? "earlier" : "more"}`;
    const rest = [label, ...blanks, ...tokenCells(mergeTotals(omitted.map((r) => r.totals)), money)].map(
      (c) => paint("dim", c),
    );
    if (timeView) body.unshift(rest);
    else body.push(rest);
  }
  const footer = ["Total", ...blanks, ...tokenCells(report.totals, money)];
  console.log(
    renderTable(
      report.headers,
      body,
      footer.map((c) => paint("bold", c)),
      1 + report.extraHeaders.length,
    ),
  );
  const notes = [
    `Costs are API list-price equivalents (pricing updated ${pricingTable.updatedAt}). On a Pro/Max plan you are not billed per token.`,
  ];
  if (report.totals.unpricedRequests) {
    const unknown = report.totals.models.filter((m) => !findModelPricing(m));
    notes.push(
      `* ${report.totals.unpricedRequests} request(s) use models missing from the pricing table (${unknown.join(", ")}) and are not included in cost.`,
    );
  }
  console.log("\n" + notes.map((n) => paint("dim", n)).join("\n"));
  return 0;
}
