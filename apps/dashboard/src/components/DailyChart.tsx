import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CurrencyConfig } from "@burnrate/core/browser";
import type { Usage } from "../api";
import { money, moneyPrecise, parseDay, seriesToken, shortDate, useTokens } from "../lib";

const TOKENS = [
  "series-1",
  "series-2",
  "series-3",
  "series-4",
  "series-other",
  "surface",
  "grid",
  "muted",
  "ink-2",
] as const;

interface TipProps {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
}

export function DailyChart({ usage, currency }: { usage: Usage; currency: CurrencyConfig }) {
  const [asTable, setAsTable] = useState(false);
  const colors = useTokens(TOKENS);
  const series = usage.series.map((s, i) => ({
    ...s,
    key: `s${i}`,
    color: colors[seriesToken(i, s.id) as (typeof TOKENS)[number]],
  }));

  // Flatten to s0..sN keys: model ids can contain dots, which Recharts would read as paths.
  const data = useMemo(
    () =>
      usage.daily.map((d) => ({
        date: d.date,
        total: d.costUsd,
        ...Object.fromEntries(series.map((s) => [s.key, d.byModel[s.id] ?? 0])),
      })),
    [usage.daily, series],
  );
  const peak = usage.daily.reduce(
    (best, d) => (d.costUsd > (best?.costUsd ?? -1) ? d : best),
    usage.daily[0],
  );

  const renderTip = ({ active, label, payload }: TipProps) => {
    if (!active || !payload?.length || label === undefined) return null;
    const total = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
    return (
      <div className="chart-tooltip">
        <h3>{shortDate(parseDay(String(label)))}</h3>
        <ul>
          {[...payload].reverse().map((p) => {
            const s = series.find((x) => x.key === p.dataKey);
            if (!s || !p.value) return null;
            return (
              <li key={s.key}>
                <span className="swatch" style={{ background: s.color }} />
                {s.label}
                <span className="value">{moneyPrecise(Number(p.value), currency)}</span>
              </li>
            );
          })}
        </ul>
        <div className="value total">Total {moneyPrecise(total, currency)}</div>
      </div>
    );
  };

  return (
    <section className="section" aria-labelledby="daily-title">
      <div className="section-head">
        <h2 id="daily-title">Daily spend</h2>
        <p>
          {peak && peak.costUsd > 0
            ? `Highest: ${money(peak.costUsd, currency)} on ${shortDate(parseDay(peak.date))}. `
            : ""}
          <button type="button" className="link-button" onClick={() => setAsTable((v) => !v)}>
            {asTable ? "Show chart" : "Show as table"}
          </button>
        </p>
      </div>

      {asTable ? (
        <div className="panel">
          <table className="items">
            <caption className="visually-hidden">Daily spend by model</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {series.map((s) => (
                  <th scope="col" key={s.key} className="hide-sm">
                    {s.label}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...usage.daily].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{shortDate(parseDay(d.date))}</td>
                  {series.map((s) => (
                    <td key={s.key} className="hide-sm">
                      {money(d.byModel[s.id] ?? 0, currency)}
                    </td>
                  ))}
                  <td>{money(d.costUsd, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          {series.length > 1 && (
            <ul className="legend" aria-label="Models">
              {series.map((s) => (
                <li key={s.key}>
                  <span className="swatch" style={{ background: s.color }} />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          <div
            style={{ height: 280 }}
            role="img"
            aria-label={`Daily spend chart for ${usage.daily.length} days. Use "Show as table" for exact values.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
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
                  allowDecimals
                />
                <Tooltip
                  content={renderTip}
                  cursor={{ fill: colors.grid, opacity: 0.6 }}
                  isAnimationActive={false}
                />
                {series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="spend"
                    fill={s.color}
                    stroke={colors.surface}
                    strokeWidth={1}
                    maxBarSize={24}
                    radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
