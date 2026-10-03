import type { ModelPricing, PricingTable } from "./types.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9][a-z0-9.-]*$/;
const STATUSES = new Set(["active", "limited", "deprecated", "retired"]);
const PRICE_KEYS = ["input", "output", "cacheWrite5m", "cacheWrite1h", "cacheRead"] as const;

const isPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Returns a list of human-readable problems; an empty list means the table is valid. */
export function validatePricingTable(table: unknown): string[] {
  const errors: string[] = [];
  const t = table as Partial<PricingTable> | null;
  if (!t || typeof t !== "object") return ["table must be an object"];
  if (t.version !== 1) errors.push(`unsupported version ${String(t.version)}`);
  if (typeof t.updatedAt !== "string" || !DATE.test(t.updatedAt)) errors.push("updatedAt must be YYYY-MM-DD");
  if (t.currency !== "USD") errors.push("currency must be USD");
  if (!Array.isArray(t.models) || t.models.length === 0) return [...errors, "models must be a non-empty array"];

  const owners = new Map<string, string>();
  const claim = (key: string, owner: string, where: string) => {
    const prev = owners.get(key);
    if (prev !== undefined && (prev !== owner || key === owner)) errors.push(`${where}: "${key}" is already used by ${prev}`);
    owners.set(key, owner);
  };

  t.models.forEach((raw, i) => {
    const m = raw as Partial<ModelPricing> | null;
    const where = `models[${i}]${m && typeof m.id === "string" ? ` (${m.id})` : ""}`;
    if (!m || typeof m !== "object") {
      errors.push(`${where}: must be an object`);
      return;
    }
    if (typeof m.id !== "string" || !ID.test(m.id)) errors.push(`${where}: id must be lowercase [a-z0-9.-]`);
    else claim(m.id, m.id, where);
    if (typeof m.provider !== "string" || !m.provider) errors.push(`${where}: provider is required`);
    if (typeof m.displayName !== "string" || !m.displayName) errors.push(`${where}: displayName is required`);
    if (!STATUSES.has(m.status as string)) errors.push(`${where}: status must be one of ${[...STATUSES].join(", ")}`);
    if (typeof m.source !== "string" || !m.source.startsWith("https://"))
      errors.push(`${where}: source must be an https URL`);
    if (typeof m.updatedAt !== "string" || !DATE.test(m.updatedAt)) errors.push(`${where}: updatedAt must be YYYY-MM-DD`);

    const p = m.prices;
    if (!p || typeof p !== "object") errors.push(`${where}: prices is required`);
    else {
      for (const k of PRICE_KEYS) if (!isPrice(p[k])) errors.push(`${where}: prices.${k} must be a number >= 0`);
      if (isPrice(p.cacheRead) && isPrice(p.input) && p.cacheRead > p.input)
        errors.push(`${where}: prices.cacheRead should not exceed prices.input`);
    }
    if (m.fastModePrices && (!isPrice(m.fastModePrices.input) || !isPrice(m.fastModePrices.output)))
      errors.push(`${where}: fastModePrices.input/output must be numbers >= 0`);

    if (m.aliases !== undefined) {
      if (!Array.isArray(m.aliases)) errors.push(`${where}: aliases must be an array`);
      else
        for (const a of m.aliases) {
          if (typeof a !== "string" || !ID.test(a)) errors.push(`${where}: alias "${String(a)}" is invalid`);
          else if (typeof m.id === "string") claim(a, m.id, where);
        }
    }
  });
  return errors;
}
