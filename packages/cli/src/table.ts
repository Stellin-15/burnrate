import { visibleLength } from "@burnrate/core";

/** Minimal aligned text table. The first `leftColumns` columns are left-aligned; the rest (numbers) right-aligned. */
export function renderTable(headers: string[], rows: string[][], footer?: string[], leftColumns = 1): string {
  const all = footer ? [headers, ...rows, footer] : [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => visibleLength(r[i] ?? ""))));
  const fmt = (r: string[]) =>
    r
      .map((cell, i) => {
        const padLen = widths[i]! - visibleLength(cell);
        return i < leftColumns ? cell + " ".repeat(padLen) : " ".repeat(padLen) + cell;
      })
      .join("  ");
  const rule = widths.map((w) => "─".repeat(w)).join("  ");
  const lines = [fmt(headers), rule, ...rows.map(fmt)];
  if (footer) lines.push(rule, fmt(footer));
  return lines.join("\n");
}

/** RFC 4180 CSV. */
export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}
