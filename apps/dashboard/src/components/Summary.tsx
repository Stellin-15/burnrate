import type { CurrencyConfig } from "@burnrate/core/browser";
import type { Budget, Usage } from "../api";
import { formatTokens, integer, longDate, money } from "../lib";

const PERIOD = { daily: "Today", weekly: "This week", monthly: "This month" } as const;

function budgetNote(b: Budget, currency: CurrencyConfig): string {
  const end = new Date(b.periodEnd);
  end.setMilliseconds(-1);
  if (b.state === "over") return `Over budget by ${money(b.spentUsd - b.limitUsd, currency)}`;
  if (b.state === "pace") return `On pace for ${money(b.projectedUsd, currency)} by ${longDate(end)}`;
  if (b.state === "warn") return `${money(b.limitUsd - b.spentUsd, currency)} left`;
  return `${money(b.limitUsd - b.spentUsd, currency)} left, on pace for ${money(b.projectedUsd, currency)}`;
}

export function Summary({ usage, currency, from }: { usage: Usage; currency: CurrencyConfig; from?: Date }) {
  const t = usage.totals;
  const start = from ?? (usage.daily[0] ? new Date(usage.daily[0].date + "T00:00") : undefined);
  const period = start ? `between ${longDate(start)} and today` : "so far";

  return (
    <section className="statement" aria-label="Spend summary">
      <div>
        <p className="total-figure">{money(t.costUsd, currency)}</p>
        <p className="total-caption">
          Spent {period} across {integer(t.requests)} requests, at API list prices.
        </p>
        <dl className="facts">
          <div>
            <dt>Input</dt>
            <dd>{formatTokens(t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens)}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{formatTokens(t.outputTokens)}</dd>
          </div>
          <div>
            <dt>Saved by caching</dt>
            <dd>{money(usage.cacheSavingsUsd, currency)}</dd>
          </div>
        </dl>
      </div>

      <div className="budgets">
        {usage.budgets.length === 0 ? (
          <p className="hint">
            Add a budget to see how this month is tracking: put <code>{'"budgets": { "monthly": 200 }'}</code>{" "}
            in <code>~/.burnrate/config.json</code>.
          </p>
        ) : (
          usage.budgets.map((b) => (
            <div key={b.period}>
              <div className="budget-head">
                <strong>{PERIOD[b.period]}</strong>
                <span>
                  {money(b.spentUsd, currency)} of {money(b.limitUsd, currency)}
                </span>
              </div>
              <div
                className="meter"
                data-state={b.state}
                role="meter"
                aria-label={`${PERIOD[b.period]} budget`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.min(b.percent, 100))}
                aria-valuetext={`${Math.round(b.percent)}% used`}
              >
                <span style={{ width: `${Math.min(b.percent, 100)}%` }} />
              </div>
              <p className="budget-note" data-state={b.state}>
                {budgetNote(b, currency)}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
