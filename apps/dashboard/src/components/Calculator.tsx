import { useEffect, useMemo, useState } from "react";
import {
  compareModels,
  type CurrencyConfig,
  type RepriceResult,
  type Workload,
} from "@burnrate/core/browser";
import { pricingTable } from "@burnrate/pricing";
import type { Api, Query, Usage } from "../api";
import { integer, money, moneyPrecise } from "../lib";

const FIELDS: Array<{ key: keyof Workload; label: string; step: number }> = [
  { key: "inputTokens", label: "Input tokens per request (uncached)", step: 1000 },
  { key: "cacheReadTokens", label: "Cached input read per request", step: 1000 },
  { key: "cacheWriteTokens", label: "Cache writes per request", step: 1000 },
  { key: "outputTokens", label: "Output tokens per request", step: 100 },
  { key: "requestsPerDay", label: "Requests per day", step: 10 },
];

const DEFAULT_WORKLOAD: Workload = {
  inputTokens: 2_000,
  cacheReadTokens: 40_000,
  cacheWriteTokens: 3_000,
  outputTokens: 800,
  requestsPerDay: 200,
};

/** Your average request over the selected range. */
function workloadFromUsage(u: Usage): Workload | undefined {
  const t = u.totals;
  if (!t.requests) return undefined;
  const days = Math.max(u.daily.filter((d) => d.requests > 0).length, 1);
  return {
    inputTokens: Math.round(t.inputTokens / t.requests),
    cacheReadTokens: Math.round(t.cacheReadTokens / t.requests),
    cacheWriteTokens: Math.round(t.cacheWriteTokens / t.requests),
    outputTokens: Math.round(t.outputTokens / t.requests),
    requestsPerDay: Math.round(t.requests / days),
  };
}

const activeModels = pricingTable.models.filter((m) => m.status === "active");
const label = (id: string) =>
  pricingTable.models.find((m) => m.id === id)?.displayName.replace(/^Claude /, "") ?? id;

export function Calculator({
  api,
  usage,
  query,
  currency,
}: {
  api: Api;
  usage: Usage | undefined;
  query: Query;
  currency: CurrencyConfig;
}) {
  const fromUsage = useMemo(() => (usage ? workloadFromUsage(usage) : undefined), [usage]);
  const [workload, setWorkload] = useState<Workload>(() => fromUsage ?? DEFAULT_WORKLOAD);
  const [source, setSource] = useState<"usage" | "custom">(fromUsage ? "usage" : "custom");
  const quotes = useMemo(() => compareModels(workload), [workload]);
  const used = new Set(usage?.models.map((m) => m.key));
  const cheapest = quotes[0]?.perMonth ?? 0;

  const set = (key: keyof Workload, v: string) => {
    const n = Math.max(0, Number(v) || 0);
    setWorkload((w) => ({ ...w, [key]: n }));
    setSource("custom");
  };

  return (
    <>
      <section className="section" aria-labelledby="calc-title" style={{ paddingTop: 0 }}>
        <div className="section-head">
          <h2 id="calc-title">Compare models for a workload</h2>
          <p>Prices from the bundled table, updated {pricingTable.updatedAt}.</p>
        </div>
        <div className="calc">
          <form className="workload" onSubmit={(e) => e.preventDefault()}>
            {FIELDS.map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type="number"
                  min={0}
                  step={f.step}
                  inputMode="numeric"
                  value={workload[f.key] ?? 0}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </label>
            ))}
            <p className="hint">
              {source === "usage" ? "Filled in from your average request in the selected range. " : ""}
              {fromUsage && source !== "usage" && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setWorkload(fromUsage);
                    setSource("usage");
                  }}
                >
                  Use my average request
                </button>
              )}
            </p>
          </form>

          <div className="panel">
            <table className="items">
              <caption className="visually-hidden">
                Cost of this workload on each model, cheapest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col" className="hide-sm">
                    Per request
                  </th>
                  <th scope="col" className="hide-sm">
                    Per day
                  </th>
                  <th scope="col">Per month</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.model.id} className={used.has(q.model.id) ? "highlight" : undefined}>
                    <td>
                      <span className="item-name">{q.model.displayName.replace(/^Claude /, "")}</span>
                      <span className="sub">
                        {used.has(q.model.id) ? "You use this. " : ""}
                        {cheapest > 0 && q.perMonth > cheapest
                          ? `${(q.perMonth / cheapest).toFixed(1)}× the cheapest`
                          : ""}
                      </span>
                    </td>
                    <td className="hide-sm">{moneyPrecise(q.perRequest.total, currency)}</td>
                    <td className="hide-sm">{money(q.perDay, currency)}</td>
                    <td>{money(q.perMonth, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <WhatIf api={api} usage={usage} query={query} currency={currency} />
    </>
  );
}

function WhatIf({
  api,
  usage,
  query,
  currency,
}: {
  api: Api;
  usage: Usage | undefined;
  query: Query;
  currency: CurrencyConfig;
}) {
  const priced = (usage?.models ?? []).filter((m) => m.unpricedRequests < m.requests);
  const [target, setTarget] = useState(
    () => activeModels.find((m) => !priced.some((p) => p.key === m.id))?.id ?? activeModels[0]!.id,
  );
  const [only, setOnly] = useState("");
  const [result, setResult] = useState<RepriceResult | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    setError(undefined);
    api
      .whatIf({ ...query, model: undefined, target, only: only || undefined })
      .then((r) => live && setResult(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [api, query, target, only]);

  if (!usage?.totals.requests) return null;
  const diff = result ? result.repricedUsd - result.actualUsd : 0;
  const pct = result && result.actualUsd > 0 ? (diff / result.actualUsd) * 100 : 0;

  return (
    <section className="section" aria-labelledby="whatif-title">
      <div className="section-head">
        <h2 id="whatif-title">What if you had used another model?</h2>
        <p>Re-prices your actual requests in the selected range.</p>
      </div>
      <div className="filters">
        <label>
          <span className="visually-hidden">Requests to re-price</span>
          <select value={only} onChange={(e) => setOnly(e.target.value)}>
            <option value="">All my requests</option>
            {priced.map((m) => (
              <option key={m.key} value={m.key}>
                Only {m.label} requests
              </option>
            ))}
          </select>
        </label>
        <span>on</span>
        <label>
          <span className="visually-hidden">Model to compare</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {activeModels.map((m) => (
              <option key={m.id} value={m.id}>
                {label(m.id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="notice">{error}</p>}
      {result && !error && (
        <>
          <div className="whatif-result" aria-live="polite">
            <div>
              <div className="hint">You paid</div>
              <div className="big">{money(result.actualUsd, currency)}</div>
            </div>
            <div>
              <div className="hint">On {label(target)}</div>
              <div className="big">{money(result.repricedUsd, currency)}</div>
            </div>
            <div className={diff < 0 ? "delta-down" : diff > 0 ? "delta-up" : undefined}>
              {diff === 0
                ? "Same cost"
                : `${diff < 0 ? "Save" : "Pay"} ${money(Math.abs(diff), currency)} (${diff < 0 ? "−" : "+"}${Math.abs(pct).toFixed(0)}%)`}
            </div>
          </div>
          <p className="hint">
            Based on {integer(result.requests)} requests.
            {result.skippedUnpriced > 0 &&
              ` ${integer(result.skippedUnpriced)} requests on unpriced models were left out.`}
          </p>
          <p className="notice">
            This keeps token counts the same. Models with a different tokenizer count the same text
            differently (Claude 4.7 and later produce about 30% more tokens than Sonnet 4.6 and earlier), and
            a different model may take more or fewer turns to finish a task. Treat it as a rough guide.
          </p>
        </>
      )}
    </section>
  );
}
