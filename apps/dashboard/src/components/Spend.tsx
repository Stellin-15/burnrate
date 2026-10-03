import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CurrencyConfig } from "@burnrate/core/browser";
import { findModelPricing } from "@burnrate/pricing";
import type { ReconcileRow, Spend as SpendData } from "../api";
import { money, moneyPrecise, parseDay, shortDate, useTokens } from "../lib";

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" };
// Colors follow the provider, never its rank: Anthropic is always slot 1, OpenAI slot 2.
const PROVIDER_TOKEN: Record<string, "series-1" | "series-2"> = { anthropic: "series-1", openai: "series-2" };
const TOKENS = ["series-1", "series-2", "surface", "grid", "muted"] as const;

function Difference({ row, currency }: { row: ReconcileRow; currency: CurrencyConfig }) {
  if (row.differenceUsd === undefined)
    return <span className="sub">{row.unpricedRows ? "no list price" : ""}</span>;
  const pct = row.computedUsd ? (row.differenceUsd / row.computedUsd) * 100 : 0;
  const sign = row.differenceUsd >= 0 ? "+" : "−";
  return (
    <span className={row.differenceUsd > 0 && pct >= 5 ? "delta-up" : undefined}>
      {sign}
      {money(Math.abs(row.differenceUsd), currency)} ({sign}
      {Math.abs(pct).toFixed(0)}%)
    </span>
  );
}

export function Spend({ spend, currency }: { spend: SpendData | undefined; currency: CurrencyConfig }) {
  const colors = useTokens(TOKENS);
  if (!spend) return null;
  if (!spend.available || !spend.syncState?.length) {
    return (
      <div className="empty">
        <h1>Track what your API organization is billed</h1>
        <p>
          If you pay for Anthropic or OpenAI API usage through an organization, add an Admin key in your
          terminal:
        </p>
        <p>
          <code>burnrate keys add anthropic</code> or <code>burnrate keys add openai</code>
        </p>
        <p className="hint">
          The key is stored in your OS keychain. While this page is open, BurnRate refreshes spend every 15
          minutes.
        </p>
      </div>
    );
  }

  const providers = spend.providers ?? [];
  const data = (spend.daily ?? []).map((d) => ({ date: d.date, ...d.byProvider }));
  const lastSync = spend.syncState.map(
    (s) =>
      `${PROVIDER_LABEL[s.provider] ?? s.provider} synced ${new Date(s.lastSyncedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${s.lastError ? ` (last attempt failed: ${s.lastError})` : ""}`,
  );

  return (
    <>
      <section className="statement" aria-label="Billed spend summary">
        <div>
          <p className="total-figure">{money(spend.totalUsd ?? 0, currency)}</p>
          <p className="total-caption">
            Billed by your API providers in the selected range, from their own cost reports.
          </p>
        </div>
        <div>
          {lastSync.map((l) => (
            <p key={l} className="budget-note">
              {l}.
            </p>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="spend-daily">
        <div className="section-head">
          <h2 id="spend-daily">Billed per day (UTC)</h2>
        </div>
        <div className="panel">
          {providers.length > 1 && (
            <ul className="legend" aria-label="Providers">
              {providers.map((p) => (
                <li key={p}>
                  <span className="swatch" style={{ background: colors[PROVIDER_TOKEN[p] ?? "series-1"] }} />
                  {PROVIDER_LABEL[p] ?? p}
                </li>
              ))}
            </ul>
          )}
          <div
            style={{ height: 240 }}
            role="img"
            aria-label="Billed spend per day. Exact values are in the table below."
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={colors.grid} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => shortDate(parseDay(d))}
                  tick={{ fill: colors.muted, fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: colors.grid }}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={(v: number) => money(v, currency)}
                  tick={{ fill: colors.muted, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                />
                <Tooltip
                  formatter={(v, name) => [
                    moneyPrecise(Number(v), currency),
                    PROVIDER_LABEL[String(name)] ?? String(name),
                  ]}
                  labelFormatter={(d) => shortDate(parseDay(String(d)))}
                  isAnimationActive={false}
                  cursor={{ fill: colors.grid, opacity: 0.6 }}
                />
                {providers.map((p, i) => (
                  <Bar
                    key={p}
                    dataKey={p}
                    stackId="spend"
                    fill={colors[PROVIDER_TOKEN[p] ?? "series-1"]}
                    stroke={colors.surface}
                    strokeWidth={1}
                    maxBarSize={24}
                    radius={i === providers.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="spend-models">
        <div className="section-head">
          <h2 id="spend-models">Billed vs. list price, by model</h2>
          <p>List price applies BurnRate&apos;s pricing table to the provider&apos;s own token counts.</p>
        </div>
        <table className="items">
          <caption className="visually-hidden">Billed and list-price cost per model</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col" className="hide-sm">
                Provider
              </th>
              <th scope="col">Billed</th>
              <th scope="col" className="hide-sm">
                At list price
              </th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {(spend.byModel ?? []).map((r) => (
              <tr key={`${r.provider}-${r.key}`}>
                <td title={r.key}>
                  {r.key === "(other)"
                    ? "Other charges (tools, sessions)"
                    : (findModelPricing(r.key)?.displayName.replace(/^Claude /, "") ?? r.key)}
                </td>
                <td className="hide-sm">{PROVIDER_LABEL[r.provider] ?? r.provider}</td>
                <td>{money(r.reportedUsd, currency)}</td>
                <td className="hide-sm">
                  {r.computedUsd === undefined ? "" : money(r.computedUsd, currency)}
                </td>
                <td>
                  <Difference row={r} currency={currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 12 }}>
          Small differences are normal: discounts, batch pricing, data residency, and server tools aren&apos;t
          in list prices. A large gap usually means BurnRate&apos;s pricing table needs an update.
        </p>
      </section>
    </>
  );
}
