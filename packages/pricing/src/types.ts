/** Prices in USD per 1,000,000 tokens. */
export interface TokenPrices {
  input: number;
  output: number;
  /** 5-minute prompt-cache write. */
  cacheWrite5m: number;
  /** 1-hour prompt-cache write. */
  cacheWrite1h: number;
  /** Prompt-cache hit / refresh. */
  cacheRead: number;
}

export type ModelStatus = "active" | "limited" | "deprecated" | "retired";

export interface ModelPricing {
  id: string;
  provider: string;
  displayName: string;
  status: ModelStatus;
  prices: TokenPrices;
  /** Premium input/output rates when fast mode is on. Cache multipliers still apply on top. */
  fastModePrices?: { input: number; output: number };
  /** Extra ids that should resolve to this entry (after normalization). */
  aliases?: string[];
  /** Where the numbers came from. Required so every price is auditable. */
  source: string;
  /** ISO date (YYYY-MM-DD) the entry was last checked against `source`. */
  updatedAt: string;
}

export interface PricingTable {
  version: number;
  updatedAt: string;
  currency: string;
  unit: string;
  models: ModelPricing[];
}
