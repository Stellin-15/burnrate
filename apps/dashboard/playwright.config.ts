import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4799);

// Runs against the built CLI (`pnpm build` first) with seeded synthetic data.
// Uses the locally installed Chrome, so no browser download is needed.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PW_CHANNEL ?? "chrome",
    colorScheme: "light",
  },
  webServer: {
    command: "node e2e/start.mjs",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(port) },
  },
});
