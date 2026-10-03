import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, resolveConfig } from "./config.js";
import { formatDuration, formatMoney, formatTokens, visibleLength } from "./format.js";

describe("resolveConfig", () => {
  it("returns defaults for undefined", () => {
    expect(resolveConfig(undefined)).toEqual({ config: DEFAULT_CONFIG, warnings: [] });
  });

  it("merges valid values", () => {
    const { config, warnings } = resolveConfig({
      theme: "minimal",
      widgets: ["model", "todayCost"],
      limits: { fiveHour: { costUsd: 40 } },
      currency: { code: "EUR", symbol: "€", rateFromUsd: 0.9 },
    });
    expect(warnings).toEqual([]);
    expect(config.theme).toBe("minimal");
    expect(config.widgets).toEqual(["model", "todayCost"]);
    expect(config.limits).toEqual({ fiveHour: { costUsd: 40 } });
    expect(config.currency.symbol).toBe("€");
  });

  it("warns and falls back instead of throwing", () => {
    const { config, warnings } = resolveConfig({
      theme: "neon",
      widgets: ["model", "nope"],
      thresholds: { warn: 90, danger: 50 },
      limits: { fiveHour: { costUsd: -1 } },
      extra: true,
    });
    expect(config.theme).toBe("default");
    expect(config.widgets).toEqual(["model"]);
    expect(config.thresholds).toEqual(DEFAULT_CONFIG.thresholds);
    expect(config.limits).toEqual({});
    expect(warnings).toHaveLength(5);
  });
});

describe("loadConfig", () => {
  const dir = mkdtempSync(join(tmpdir(), "burnrate-config-"));

  it("handles a missing file", () => {
    const r = loadConfig(join(dir, "missing.json"));
    expect(r.exists).toBe(false);
    expect(r.config).toEqual(DEFAULT_CONFIG);
  });

  it("handles invalid JSON", () => {
    const p = join(dir, "broken.json");
    writeFileSync(p, "{ nope");
    const r = loadConfig(p);
    expect(r.exists).toBe(true);
    expect(r.warnings[0]).toMatch(/could not parse/);
  });
});

describe("format", () => {
  it.each([
    [0, "$0.00"],
    [0.004, "$<0.01"],
    [1.234, "$1.23"],
    [1234.5, "$1,235"],
  ])("formatMoney(%s) = %s", (v, s) => expect(formatMoney(v)).toBe(s));

  it.each([
    [999, "999"],
    [1234, "1.2k"],
    [45_000, "45k"],
    [2_500_000, "2.5M"],
  ])("formatTokens(%s) = %s", (v, s) => expect(formatTokens(v)).toBe(s));

  it.each([
    [30_000, "<1m"],
    [42 * 60_000, "42m"],
    [72 * 60_000, "1h12m"],
    [120 * 60_000, "2h"],
    [(3 * 24 + 4) * 60 * 60_000, "3d4h"],
  ])("formatDuration(%s) = %s", (v, s) => expect(formatDuration(v)).toBe(s));

  it("measures visible length without ANSI codes", () => {
    expect(visibleLength("\x1b[32mabc\x1b[0m")).toBe(3);
  });
});

describe("examples/*.json", () => {
  const dir = new URL("../../../examples/", import.meta.url);
  it.each(readdirSync(dir).filter((f) => f.endsWith(".json")))("%s is valid", (file) => {
    const { warnings } = resolveConfig(JSON.parse(readFileSync(new URL(file, dir), "utf8")));
    expect(warnings).toEqual([]);
  });
});
