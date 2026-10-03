import type { CurrencyConfig } from "@burnrate/core/browser";
import type { Row } from "../api";
import { formatTokens, integer, money } from "../lib";

/** An itemized list: one row per model/project/session, with its share of the total as a thin bar. */
export function LineItems({
  title,
  rows,
  currency,
  limit = 8,
  nameHeader,
  subOf,
}: {
  title: string;
  rows: Row[];
  currency: CurrencyConfig;
  limit?: number;
  nameHeader: string;
  subOf?: (r: Row) => string | undefined;
}) {
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  const restCost = rest.reduce((s, r) => s + r.costUsd, 0);

  if (!rows.length) return null;
  return (
    <table className="items">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">{nameHeader}</th>
          <th scope="col" className="hide-sm">
            Requests
          </th>
          <th scope="col" className="hide-sm">
            Tokens
          </th>
          <th scope="col">Cost</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => {
          const share = total > 0 ? (r.costUsd / total) * 100 : 0;
          const sub = subOf?.(r);
          return (
            <tr key={r.key}>
              <td title={r.key}>
                <span className="item-name">{r.label}</span>
                {sub && <span className="sub">{sub}</span>}
                <span className="share" style={{ width: `${share}%` }} aria-hidden="true" />
              </td>
              <td className="hide-sm">{integer(r.requests)}</td>
              <td className="hide-sm">{formatTokens(r.totalTokens)}</td>
              <td>
                {r.unpricedRequests === r.requests ? (
                  <span title="This model isn't in the pricing table yet">no price</span>
                ) : (
                  money(r.costUsd, currency)
                )}
              </td>
            </tr>
          );
        })}
        {rest.length > 0 && (
          <tr>
            <td>{rest.length} more</td>
            <td className="hide-sm">{integer(rest.reduce((s, r) => s + r.requests, 0))}</td>
            <td className="hide-sm">{formatTokens(rest.reduce((s, r) => s + r.totalTokens, 0))}</td>
            <td>{money(restCost, currency)}</td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td className="hide-sm">{integer(rows.reduce((s, r) => s + r.requests, 0))}</td>
          <td className="hide-sm">{formatTokens(rows.reduce((s, r) => s + r.totalTokens, 0))}</td>
          <td>{money(total, currency)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
