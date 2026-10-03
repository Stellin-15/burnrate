import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#token=e2e-token");
  await expect(page.locator(".total-figure")).toHaveText(/^\$[\d,]+\.\d\d$/);
  return errors;
};

test("shows usage from local data without errors", async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByRole("table", { name: "By model" })).toBeVisible();
  await expect(page.getByRole("table", { name: "By project" })).toContainText("acme-api");
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await expect(page.getByText("This month")).toBeVisible();
  // The token is removed from the address bar once read.
  expect(new URL(page.url()).hash).toBe("");
  expect(errors).toEqual([]);
});

test("refuses to load data without the token", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open the dashboard from your terminal" })).toBeVisible();
});

test("range filter changes the totals", async ({ page }) => {
  await open(page);
  const month = await page.locator(".total-figure").textContent();
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.locator(".total-figure")).not.toHaveText(month!);
});

test("daily chart has an accessible table view", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Show as table" }).click();
  await expect(page.getByRole("table", { name: "Daily spend by model" })).toBeVisible();
});

test("calculator matches hand-checked numbers", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Cost calculator" }).click();
  const set = (label: string, value: string) => page.getByLabel(label).fill(value);
  await set("Input tokens per request (uncached)", "10000");
  await set("Cached input read per request", "0");
  await set("Cache writes per request", "0");
  await set("Output tokens per request", "1000");
  await set("Requests per day", "100");
  const table = page.getByRole("table", { name: /cheapest first/ });
  // Sonnet 5.5: 10k x $2/M + 1k x $10/M = $0.03/request -> $3/day -> $90/month
  await expect(table.getByRole("row", { name: /^Sonnet 5\.5/ })).toContainText("$0.0300");
  await expect(table.getByRole("row", { name: /^Sonnet 5\.5/ })).toContainText("$90.00");
  // Haiku 4.5: $0.015/request -> $45/month, and it's the cheapest
  await expect(table.getByRole("row").nth(1)).toContainText("Haiku 4.5");
  await expect(table.getByRole("row", { name: /^Haiku 4\.5/ })).toContainText("$45.00");
  // Opus 5.5: $0.06/request -> $180/month
  await expect(table.getByRole("row", { name: /^Opus 5\.5/ })).toContainText("$180.00");
});

test("what-if re-prices history", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Cost calculator" }).click();
  await page.getByLabel("Model to compare").selectOption("claude-haiku-4-5");
  await expect(page.locator(".whatif-result")).toContainText("Save");
});

test("exports CSV", async ({ page }) => {
  await open(page);
  await page.getByText("Export", { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "By model (CSV)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^burnrate-models-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv.split("\n")[0]).toBe(
    "key,label,requests,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,costUsd",
  );
});

test("shows real Claude plan limits from the status line snapshot", async ({ page }) => {
  await open(page);
  const limits = page.getByRole("region", { name: "Claude plan limits" });
  await expect(limits).toContainText("5-hour limit");
  await expect(limits).toContainText("39% used");
  await expect(limits).toContainText("Weekly limit");
});

test("API spend tab compares billed cost with list price", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "API spend" }).click();
  // 10 days x ($32 Anthropic + $11.25 OpenAI)
  await expect(page.locator(".total-figure")).toHaveText("$432.50");
  const table = page.getByRole("table", { name: "Billed and list-price cost per model" });
  // Opus 5.5 per day at list price: $4 + $2 + $8 + $20 = $34; billed $32 -> -$2 (-6%) per day
  await expect(table.getByRole("row", { name: /Opus 5.5/ })).toContainText("$340.00");
  await expect(table.getByRole("row", { name: /Opus 5.5/ })).toContainText("−$20.00 (−6%)");
  await expect(table.getByRole("row", { name: /gpt-5/ })).toContainText("no list price");
});
