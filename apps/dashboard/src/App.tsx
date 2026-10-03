import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createApi,
  readToken,
  type Limits,
  type Meta,
  type Query,
  type Spend as SpendData,
  type Usage,
} from "./api";
import { Calculator } from "./components/Calculator";
import { DailyChart } from "./components/DailyChart";
import { LineItems } from "./components/LineItems";
import { PlanLimits } from "./components/PlanLimits";
import { Spend } from "./components/Spend";
import { Summary } from "./components/Summary";
import { RANGES, rangeStart, type RangeId } from "./lib";

const sessionTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type Tab = "usage" | "calculator" | "spend";

const EXPORTS = [
  { view: "daily", label: "Daily spend" },
  { view: "models", label: "By model" },
  { view: "projects", label: "By project" },
  { view: "sessions", label: "Top sessions" },
  { view: "events", label: "Every request" },
] as const;

function readPrefs(): { range: RangeId; tab: Tab } {
  try {
    const p = JSON.parse(localStorage.getItem("burnrate-prefs") ?? "{}");
    return {
      range: RANGES.some((r) => r.id === p.range) ? p.range : "30d",
      tab: p.tab === "calculator" || p.tab === "spend" ? p.tab : "usage",
    };
  } catch {
    return { range: "30d", tab: "usage" };
  }
}

export function App() {
  const token = useMemo(readToken, []);
  const api = useMemo(() => (token ? createApi(token) : undefined), [token]);
  const prefs = useMemo(readPrefs, []);
  const [tab, setTab] = useState<Tab>(prefs.tab);
  const [range, setRange] = useState<RangeId>(prefs.range);
  const [project, setProject] = useState("");
  const [model, setModel] = useState("");
  const [meta, setMeta] = useState<Meta>();
  const [usage, setUsage] = useState<Usage>();
  const [spend, setSpend] = useState<SpendData>();
  const [limits, setLimits] = useState<Limits>();
  const [error, setError] = useState<{ message: string; auth: boolean }>();
  const exportRef = useRef<HTMLDetailsElement>(null);

  const from = useMemo(() => rangeStart(range), [range]);
  const query: Query = useMemo(
    () => ({ from: from?.toISOString(), project: project || undefined, model: model || undefined }),
    [from, project, model],
  );

  useEffect(() => {
    try {
      localStorage.setItem("burnrate-prefs", JSON.stringify({ range, tab }));
    } catch {
      // private mode: preferences just won't stick
    }
  }, [range, tab]);

  const fail = (e: unknown) =>
    setError({
      message: e instanceof Error ? e.message : String(e),
      auth: e instanceof ApiError && e.status === 401,
    });

  useEffect(() => {
    api?.meta().then(setMeta, fail);
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let live = true;
    const load = () => {
      api.usage(query).then((u) => {
        if (live) {
          setUsage(u);
          setError(undefined);
        }
      }, fail);
      // Optional extras: older servers or no data just leave them empty.
      api.limits().then(
        (l) => live && setLimits(l),
        () => undefined,
      );
      api.spend({ from: query.from }).then(
        (x) => live && setSpend(x),
        () => undefined,
      );
    };
    load();
    // New Claude Code activity shows up without a reload.
    const timer = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, query]);

  if (!api || error?.auth) {
    return (
      <main className="shell">
        <div className="empty">
          <h1>Open the dashboard from your terminal</h1>
          <p>
            This page needs the private link that <code>burnrate dashboard</code> prints when it starts. Run
            it again and open that link.
          </p>
        </div>
      </main>
    );
  }

  const currency = meta?.currency ?? { code: "USD", symbol: "$", rateFromUsd: 1 };
  const download = (view: string, format: "csv" | "json") => {
    exportRef.current?.removeAttribute("open");
    api.download({ ...query, view, format }).catch(fail);
  };

  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand">
          <img src="./favicon.svg" alt="" />
          BurnRate
        </div>
        <div className="filters">
          <div className="segmented" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <label>
            <span className="visually-hidden">Project</span>
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">All projects</option>
              {meta?.projects.map((p) => (
                <option key={p.id} value={p.id} title={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="visually-hidden">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">All models</option>
              {meta?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <details className="export" ref={exportRef}>
            <summary className="button">Export</summary>
            <div className="menu" role="menu">
              {EXPORTS.map((x) => (
                <button key={x.view} type="button" role="menuitem" onClick={() => download(x.view, "csv")}>
                  {x.label} (CSV)
                </button>
              ))}
              <button type="button" role="menuitem" onClick={() => download("events", "json")}>
                Every request (JSON)
              </button>
            </div>
          </details>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Views">
        <button type="button" role="tab" aria-selected={tab === "usage"} onClick={() => setTab("usage")}>
          Usage
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "calculator"}
          onClick={() => setTab("calculator")}
        >
          Cost calculator
        </button>
        <button type="button" role="tab" aria-selected={tab === "spend"} onClick={() => setTab("spend")}>
          API spend
        </button>
      </nav>

      {error && (
        <p className="notice">Couldn't load data: {error.message}. Is `burnrate dashboard` still running?</p>
      )}

      {tab === "usage" &&
        usage &&
        (meta && meta.eventCount === 0 ? (
          <div className="empty">
            <h1>No usage yet</h1>
            <p>
              BurnRate reads Claude Code's local transcripts. Use Claude Code for a bit, then refresh this
              page. Run <code>burnrate doctor</code> if it stays empty.
            </p>
          </div>
        ) : (
          <>
            {limits && <PlanLimits limits={limits} />}
            <Summary usage={usage} currency={currency} from={from} />
            {usage.unpricedModels.length > 0 && (
              <p className="notice">
                {usage.unpricedModels.join(", ")} {usage.unpricedModels.length === 1 ? "isn't" : "aren't"} in
                the pricing table, so {usage.unpricedModels.length === 1 ? "its" : "their"} requests aren't
                counted in the totals.
              </p>
            )}
            <DailyChart usage={usage} currency={currency} />
            <section className="section two-col" aria-label="Line items">
              <LineItems title="By model" nameHeader="Model" rows={usage.models} currency={currency} />
              <LineItems
                title="By project"
                nameHeader="Project"
                rows={usage.projects}
                currency={currency}
                subOf={(r) => (r.key !== r.label ? r.key : undefined)}
              />
            </section>
            <section className="section" aria-label="Sessions">
              <LineItems
                title="Most expensive sessions"
                nameHeader="Session"
                rows={usage.sessions}
                currency={currency}
                limit={10}
                subOf={(r) => {
                  const started = (r as (typeof usage.sessions)[number]).startedAt;
                  return started ? `Started ${sessionTime.format(new Date(started))}` : undefined;
                }}
              />
            </section>
          </>
        ))}

      {tab === "spend" && <Spend spend={spend} currency={currency} />}

      {tab === "calculator" && (
        <Calculator key={range + project} api={api} usage={usage} query={query} currency={currency} />
      )}

      <footer className="footer">
        Costs are API list-price equivalents
        {meta ? `, priced with the table updated ${meta.pricingUpdatedAt}` : ""}. On a Pro or Max plan you
        aren't billed per token. Everything here stays on this computer.
        {meta ? ` BurnRate ${meta.version}.` : ""}
      </footer>
    </main>
  );
}
