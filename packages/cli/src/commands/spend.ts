import { formatMoney, loadConfig, reconcile, type ProviderId } from "@burnrate/core";
import { openStoreQuietly } from "@burnrate/store";
import { colorEnabled, paintAnsi, paintNone } from "../ansi.js";
import { PROVIDERS, isProvider, osKeychain, resolveKey, type Keychain } from "../keys.js";
import { syncProvider, syncWindowStart } from "../sync.js";
import { renderTable, toCsv } from "../table.js";
import { explainProviderError } from "./keys.js";

/** `burnrate sync [provider] [--days N]`: pull usage and billed cost for every provider with a key. */
export async function runSync(args: { provider?: string; days?: number }): Promise<number> {
  if (args.provider && !isProvider(args.provider)) {
    console.error("Usage: burnrate sync [anthropic|openai] [--days 30]");
    return 2;
  }
  const kc = await osKeychain();
  const keychain: Keychain | undefined = "error" in kc ? undefined : kc;
  const providers = (args.provider ? [args.provider] : Object.keys(PROVIDERS)) as ProviderId[];
  const withKeys = providers.flatMap((p) => {
    const k = resolveKey(p, keychain);
    return k ? [{ provider: p, key: k.key }] : [];
  });
  if (!withKeys.length) {
    console.error("No API keys set up. Add one with `burnrate keys add anthropic` (or openai).");
    return 1;
  }
  const { store, problem } = openStoreQuietly();
  if (!store) {
    console.error(`Can't sync: ${problem}.`);
    return 1;
  }
  let failed = 0;
  try {
    for (const { provider, key } of withKeys) {
      const label = PROVIDERS[provider].label;
      try {
        const r = await syncProvider(provider, key, store, { days: args.days ?? 30 });
        console.log(
          `✓ ${label}: ${r.usageRows} usage rows, ${r.costRows} cost lines, $${r.reportedUsd.toFixed(2)} billed`,
        );
      } catch (err) {
        failed++;
        console.error(`✗ ${explainProviderError(provider, err)}`);
      }
    }
  } finally {
    store.close();
  }
  return failed ? 1 : 0;
}

/** `burnrate spend`: what providers billed, next to what list prices predict for the same tokens. */
export async function runSpend(args: {
  days?: number;
  by?: string;
  format: "table" | "json" | "csv";
}): Promise<number> {
  const by = args.by === "model" ? "model" : "day";
  const { config } = loadConfig();
  const { store, problem } = openStoreQuietly();
  if (!store) {
    console.error(`Can't read spend: ${problem}.`);
    return 1;
  }
  const from = syncWindowStart(args.days ?? 30).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const rows = reconcile(store.providerUsage(from, to), store.providerCosts(from, to), by);
  const synced = store.syncState();
  store.close();

  if (!synced.length) {
    const kc = await osKeychain();
    const hasKey = (Object.keys(PROVIDERS) as ProviderId[]).some((p) =>
      resolveKey(p, "error" in kc ? undefined : kc),
    );
    console.error(
      hasKey
        ? "Nothing synced yet. Run `burnrate sync`."
        : "No provider data yet. Add an Admin key with `burnrate keys add anthropic` (or openai).",
    );
    return 1;
  }

  if (args.format === "json") {
    console.log(JSON.stringify({ by, from, rows, lastSync: synced }, null, 2));
    return 0;
  }
  if (args.format === "csv") {
    console.log(
      toCsv(
        [by, "provider", "reportedUsd", "computedUsd", "differenceUsd"],
        rows.map((r) => [r.key, r.provider, r.reportedUsd, r.computedUsd ?? "", r.differenceUsd ?? ""]),
      ),
    );
    return 0;
  }

  const paint = colorEnabled() ? paintAnsi : paintNone;
  const money = (n: number) => formatMoney(n, config.currency);
  const diff = (r: (typeof rows)[number]) => {
    if (r.differenceUsd === undefined) return r.unpricedRows ? "unpriced" : "";
    const pct = r.computedUsd ? (r.differenceUsd / r.computedUsd) * 100 : 0;
    const text = `${r.differenceUsd >= 0 ? "+" : "−"}${money(Math.abs(r.differenceUsd))} (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%)`;
    // Only flag being billed noticeably MORE than list price; less is a discount.
    return r.differenceUsd > 0 && pct >= 5 ? paint("yellow", text) : text;
  };
  if (!rows.length) {
    console.log(`No billed usage since ${from.slice(0, 10)}.`);
    return 0;
  }
  const total = rows.reduce((s, r) => s + r.reportedUsd, 0);
  console.log(
    renderTable(
      [by === "day" ? "Date (UTC)" : "Model", "Provider", "Billed", "At list price", "Difference"],
      rows.map((r) => [
        r.key,
        PROVIDERS[r.provider].label,
        money(r.reportedUsd),
        r.computedUsd === undefined ? "" : money(r.computedUsd),
        diff(r),
      ]),
      ["Total", "", money(total), "", ""].map((c) => paint("bold", c)),
      2,
    ),
  );
  console.log(
    paint(
      "dim",
      [
        "\nBilled = what the provider charged (its own cost report). At list price = BurnRate's pricing table applied to the provider's token counts.",
        "Differences usually come from discounts, batch pricing, data residency, web search, or a pricing table that needs updating.",
        ...synced.map(
          (s) =>
            `${PROVIDERS[s.provider as ProviderId]?.label ?? s.provider} last synced ${new Date(s.lastSyncedAt).toLocaleString()}${s.lastError ? ` (last attempt failed: ${s.lastError})` : ""}.`,
        ),
      ].join("\n"),
    ),
  );
  return 0;
}
