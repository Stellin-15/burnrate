import type { Limits } from "../api";

const LABEL = { fiveHour: "5-hour limit", sevenDay: "Weekly limit", spendLimit: "Spend limit" } as const;

function until(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Real Claude plan limits, as last reported to the status line by Claude Code. */
export function PlanLimits({
  limits,
  warn = 60,
  danger = 85,
}: {
  limits: Limits;
  warn?: number;
  danger?: number;
}) {
  if (!limits.windows.length) return null;
  const observed = limits.observedAt ? new Date(limits.observedAt) : undefined;
  return (
    <section className="plan-limits" aria-label="Claude plan limits">
      {limits.windows.map((w) => {
        const state = w.usedPercent >= danger ? "over" : w.usedPercent >= warn ? "warn" : "ok";
        return (
          <div key={w.id} className="plan-limit">
            <div className="budget-head">
              <strong>{LABEL[w.id]}</strong>
              <span>
                {Math.round(w.usedPercent)}% used, resets in {until(w.resetsAt)}
              </span>
            </div>
            <div
              className="meter"
              data-state={state}
              role="meter"
              aria-label={LABEL[w.id]}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(w.usedPercent, 100))}
            >
              <span style={{ width: `${Math.min(w.usedPercent, 100)}%` }} />
            </div>
          </div>
        );
      })}
      {observed && (
        <p className="budget-note">
          From Claude Code, as of{" "}
          {observed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.
        </p>
      )}
    </section>
  );
}
