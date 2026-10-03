# BurnRate: Cross-Platform AI Usage Meter + Cost Dashboard

> Hand this file to Claude Code. Start with: "Read PROJECT_PLAN.md and build Phase 0 and Phase 1. Stop and summarize before Phase 2."

Repo name: `burnrate`
Alternate names if taken: `tokenmeter`, `spendline`, `gaugecode`, `limitlight`

---

## 0. Status and decisions (updated 2026-10-03)

**Phases 0–3 are built.** `burnrate init claude-code` adds a live meter to Claude Code, `burnrate report` gives cost tables, `burnrate dashboard` serves a local web dashboard (budgets, cost calculator, plan limits, API spend), and `burnrate keys` / `sync` / `spend` track what Anthropic and OpenAI organizations are billed. 181 unit tests and 9 browser end-to-end tests pass, along with lint, format, typecheck, and pricing validation, on macOS, Linux, and Windows. How to use it: [README.md](README.md). What external formats it relies on: [docs/research.md](docs/research.md).

Tested on real data (2026-10-03): `doctor` and `report` parsed 1,750 real requests with every model priced. Per-model costs match a hand recomputation from published rates, including the 1-hour cache-write split. The live meter shows real 5h/7d limits.

### Phase 3 notes

- **Decisions (approved 2026-10-03):** built-in `node:sqlite` for history (minimum Node is now 22.13), `@napi-rs/keyring` for keys (prebuilt, optional, lazy-loaded), Anthropic and OpenAI first (Google deferred: no simple usage API), network access opt-in only.
- **History:** `~/.burnrate/burnrate.db` archives Claude Code usage whenever `report`, `dashboard`, or `doctor` runs, so reports outlive Claude Code's 30-day transcript cleanup. The status line never opens the database.
- **Done-when check:** `burnrate keys add <provider>` verifies the key with a real sync before saving it and backfills 30 days.
- **Reconciliation:** `burnrate spend` and the dashboard's API spend tab compare billed cost with list price for the same tokens. OpenAI rows show "unpriced" until OpenAI prices are added to `models.json`.
- **Not verified against real provider APIs** (no organization Admin key was available). The clients follow the official docs and OpenAPI spec and are tested against responses in those documented shapes. First real use: run `burnrate keys add anthropic` and compare `burnrate spend` with the Console's Cost page.

### VS Code (requested 2026-10-03)

The Claude Code VS Code extension's chat panel doesn't display custom status lines. Observed: with the meter installed, ten minutes of activity in the chat panel triggered no status line runs. (Caveat: that conversation started before the install.) Plan:

1. **Groundwork, done:** every status line run saves the real limits and recent session IDs to `~/.burnrate/state/last-status.json`, and the dashboard already shows them.
2. **Confirm** whether a _new_ chat-panel conversation runs the status line command. If it does, the panel feeds real limits too; if not, limits update whenever any terminal Claude Code session runs.
3. **Built (2026-10-03):** `apps/vscode`, the "BurnRate" VS Code extension. A status bar item shows the same meter (real 5h/7d limits from the snapshot; today's cost from the shared, cached transcript summary), a tooltip has details, and a click starts `burnrate dashboard` using the node and script that `init` wrote into Claude Code's settings. It reads local files only and makes no network calls. It updates within a second of a new snapshot (file watcher), otherwise every 30 seconds. Packaged as a 17 KB `.vsix`; F5 runs it from the repo.

### Phase 2 notes

- **Done-when check:** the dashboard shows real local data (served from the same transcript loader as `report`), and an end-to-end test checks that the calculator UI shows hand-checked numbers: Sonnet 5.5 $90/month, Haiku 4.5 $45, Opus 5.5 $180 for 10k input + 1k output tokens per request × 100 requests/day.
- **Built without a database.** The dashboard reads transcripts through the same incremental cache, so history is still limited by Claude Code's 30-day transcript retention. **The SQLite decision below is still open.**
- **Security:** the server binds to 127.0.0.1, rejects non-loopback `Host` headers (DNS rebinding), needs a per-run token passed in the URL fragment, is GET-only, sends no CORS headers, and serves the UI with a strict CSP.
- **Offline:** fonts (Archivo, OFL) and all scripts are bundled; the page makes no third-party requests.
- **E2E tests** use Playwright with the locally installed Chrome (no browser download) against seeded synthetic data (`apps/dashboard/e2e/seed.mjs`).
- **Added beyond the plan:** "saved by caching" figure, budget pace projection, and the calculator can start from your real average request.

### What research changed

- **Claude Code now reports real subscription limits.** The status line's stdin JSON includes `rate_limits.five_hour` and `rate_limits.seven_day` (`used_percentage`, `resets_at`) for Pro/Max subscribers, plus `rate_limits.spend_limit` behind an org gateway. The meter shows these **exact** numbers and uses local estimates only as a fallback (API-key users, before the first response, other tools). This reverses risk #1 in section 7 for Claude Code.
- **Time-to-limit projection** comes from sampling the official percentage over the last hour (`~/.burnrate/state/ratelimit-samples.json`), not from guessing plan sizes.
- **Pricing is not uniform:** cache-read multipliers differ by model (0.025×, 0.05×, 0.1×), there are separate 5-minute and 1-hour cache-write rates, and fast mode has its own rates. `models.json` stores every rate explicitly, and `UsageEvent` gained `cacheWrite1hTokens` and `speed`.
- **Transcripts are deleted after `cleanupPeriodDays`** (default 30). Long-term history needs BurnRate to store events itself (the Phase 2 SQLite item).

### Decisions made during the build

| Decision                                                                                                                      | Why                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No SQLite in Phase 1. A small incremental JSON cache (`~/.burnrate/cache/`) instead                                           | `better-sqlite3` needs native compilation, which section 10 says to ask about first. The JSON cache re-reads only appended bytes and is enough for the status line. **Open question for Phase 2:** approve `better-sqlite3`, or use Node's built-in `node:sqlite` (Node 22.5+, no native build)? |
| No CLI framework (uses `node:util` `parseArgs`) and no Turborepo                                                              | Zero runtime dependencies; plain `pnpm -r` is enough at this size                                                                                                                                                                                                                                |
| CLI bundled with tsup into `dist/`, published as **`burnrate-cli`** (binary still `burnrate`)                                 | `burnrate` is taken on npm. Bundling makes the published package self-contained                                                                                                                                                                                                                  |
| `init` pins absolute `node` and script paths, with forward slashes                                                            | Claude Code may run with a different PATH, and runs commands through Git Bash on Windows; `npx` would add about 1s per refresh                                                                                                                                                                   |
| `init` records the previous `statusLine` so `uninstall` restores it, and refuses to overwrite a foreign one without `--force` | Never silently destroy user config                                                                                                                                                                                                                                                               |
| Status line always exits 0 and logs errors to `~/.burnrate/logs/`                                                             | A broken meter must not break Claude Code's UI                                                                                                                                                                                                                                                   |

### Measured performance

On Windows 11 with Node 22 and about 1 MB of transcripts, `burnrate statusline` takes **~280 ms wall-clock, of which ~235 ms is Node's own startup** (`node -e 0`). BurnRate's own work is ~45 ms when cached and ~70 ms when it rescans. The 50 ms target in section 7 holds for BurnRate's code but not end to end, because of Node startup. If that matters, the options are a Node single-executable build or a tiny native shim (Phase 5).

### Known gaps (to verify with real data)

- Fixtures are **synthetic**, built from the documented transcript shape. Run `burnrate report` and `burnrate doctor` against a real `~/.claude` and compare with Claude Code's `/cost` before the first release.
- It's unconfirmed how fast-mode requests are marked in transcripts (the parser accepts `usage.speed: "fast"`).
- Not on npm yet. Install from source (see README).

### Ideas added for later phases

- **Phase 2:** persist events to SQLite so reports outlive the 30-day transcript retention. **Calibrate** plan limits automatically: when Claude Code reports `five_hour.used_percentage = p` while local usage in that window is `c`, then limit ≈ `c / p`. That gives subscribers a realistic estimate in other tools and the dashboard, too.
- **Phase 4:** the status line already supports `rate_limits.spend_limit`. Mirror it in the overlay for org-gateway users.
- **Phase 5:** a `--format json` mode for `statusline`, so other status line tools can embed BurnRate data.

---

## 1. What it is

A local-first, open-source toolkit that answers two questions for anyone using AI coding tools and APIs:

1. **How much usage limit do I have left right now?** (live meter in the terminal status line, desktop overlay, or above the chat)
2. **How much am I spending, and on which model?** (cost dashboard + multi-model cost calculator)

Works with Claude Code first, then other tools (Codex CLI, Gemini CLI, Cursor, OpenCode, Aider, etc.) through an adapter system. Users can wire in their own API keys to track real spend.

## 2. Goals and non-goals

**Goals**

- Cross-platform: macOS, Linux, Windows
- Local-first: no account, no server, data never leaves the machine
- Pluggable: new tools and providers are adapters, not core changes
- Customizable meter: themes, layouts, thresholds, which widgets show
- Accurate cost math using a versioned, community-editable pricing table

**Non-goals (v1)**

- No hosted SaaS or team accounts
- No proxying or intercepting API traffic
- No scraping of private web endpoints (see Risks)

## 3. Core features

### A. Usage meter

- Claude Code status line integration (Claude Code supports a custom `statusLine` command in settings that receives session JSON on stdin; verify current schema in the docs before building)
- Estimated remaining limit for rolling windows (for example 5-hour session window and weekly window), based on local transcript logs plus user-configured plan limits
- Color thresholds (green/yellow/red), percent bar, time-until-reset, burn rate, projected time to limit
- Desktop overlay (always-on-top small window) for tools with no status line
- Browser extension (phase 4) that shows a meter bar above the chat on web apps

### B. Cost dashboard

- Local web app (served by `burnrate dashboard`)
- Add API keys per provider, stored in the OS keychain, never in plain files
- Pulls real usage/cost from provider usage APIs where they exist (Anthropic and OpenAI have org usage/cost endpoints that need admin-level keys; verify current endpoints in docs)
- Falls back to local log parsing when no key is provided
- Views: spend by day/week/month, by model, by project, by tool; budget alerts; CSV/JSON export

### C. Multi-model cost calculator

- Input: input tokens, output tokens, cached tokens, requests per day
- Output: cost per model side by side across providers
- "What if I switched model X to model Y" comparison on real historical usage
- Pricing table in `packages/pricing/models.json`, versioned, with `updatedAt` and source URL per model

### D. Customization

- `burnrate.config.json` (and UI editor) for: widgets, theme, thresholds, plan limits, currency, refresh interval
- Theme packs (JSON): colors, bar style, icons, compact vs verbose
- Per-tool profiles so each coding tool can have its own layout

## 4. Architecture

TypeScript monorepo, pnpm workspaces, Node 22+ (moved from 20 on 2026-10-03; Node 20 reached end of life in April 2026).

```
burnrate/
  packages/
    core/          # event schema, cost engine, limit estimator, config loader
    pricing/       # models.json + validator + update script
    adapters/
      claude-code/ # parses ~/.claude/projects/**/*.jsonl, statusline stdin
      codex-cli/
      gemini-cli/
      opencode/
      anthropic-api/   # usage + cost API client
      openai-api/
      google-api/
    cli/           # `burnrate` binary (statusline, report, dashboard, config)
  apps/
    dashboard/     # React + Vite (or Next.js) local web UI
    overlay/       # Tauri always-on-top meter
    extension/     # WebExtension (Manifest V3), phase 4
  docs/
  examples/
```

### Normalized event schema (core)

```ts
type UsageEvent = {
  id: string;
  timestamp: string; // ISO
  tool: string; // "claude-code" | "codex-cli" | ...
  provider: string; // "anthropic" | "openai" | ...
  model: string;
  project?: string;
  sessionId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number; // computed or reported
  source: "local-log" | "provider-api" | "statusline";
};
```

### Adapter interface

```ts
interface Adapter {
  id: string;
  detect(): Promise<boolean>; // is this tool installed/used?
  readEvents(since: Date): AsyncIterable<UsageEvent>;
  watch?(onEvent: (e: UsageEvent) => void): () => void;
}
```

Adding a new tool = one new adapter package plus a pricing entry. Document this in `docs/writing-an-adapter.md`.

### Storage

- Phase 1: incremental JSON cache under `~/.burnrate/cache/` (no native dependencies)
- Phase 2: SQLite at `~/.burnrate/burnrate.db`, deduped by event id (`better-sqlite3` or built-in `node:sqlite`, pending approval)
- Secrets via OS keychain (`keytar` or equivalent), never in the DB or config

## 5. Phased build plan

### Phase 0: Scaffold

- pnpm monorepo, TypeScript strict, ESLint, Prettier, Vitest, changesets
- GitHub Actions: lint, test, build on mac/linux/windows
- LICENSE (MIT), README skeleton, CONTRIBUTING, issue templates
- **Done when:** `pnpm build && pnpm test` passes in CI on all 3 OSes

### Phase 1: Core + Claude Code meter (MVP)

- `packages/pricing` with current Anthropic models
- `packages/core` cost engine with unit tests (cache read/write pricing included)
- `adapters/claude-code`: parse local JSONL transcripts into `UsageEvent`s, handle dedupe and malformed lines
- Limit estimator: rolling window math with configurable plan limits
- `cli`: `burnrate statusline` (reads Claude Code JSON on stdin, prints a one-line meter), `burnrate report`
- `burnrate init claude-code` command that safely edits Claude Code settings to add the statusLine (backs up the original first)
- **Done when:** a user runs two commands and sees a live meter in Claude Code

### Phase 2: Dashboard + calculator

- `apps/dashboard` served by `burnrate dashboard`
- Charts, filters, model/project breakdown, budget alerts
- Calculator page with the pricing table and "what if" comparison
- Export CSV/JSON
- **Done when:** dashboard shows real local data and the calculator matches hand-checked numbers

### Phase 3: API key tracking

- Keychain-backed key manager in CLI and UI
- `anthropic-api`, `openai-api`, `google-api` adapters using official usage/cost endpoints
- Reconciliation view: provider-reported cost vs locally computed cost
- **Done when:** adding a key backfills last 30 days of real spend

### Phase 4: Multi-tool + overlay + extension

- Adapters for Codex CLI, Gemini CLI, OpenCode, Aider (one at a time, each with fixtures and tests)
- Tauri overlay with the same meter widget
- WebExtension that renders a meter above the chat input on supported web apps, fed by local daemon over `localhost` with a random per-install token
- **Done when:** at least 3 tools beyond Claude Code work end to end

### Phase 5: Customization + polish

- Theme packs, widget layout editor, per-tool profiles
- Docs site, demo GIFs, `npx burnrate` and Homebrew/winget/scoop install
- Public pricing-update workflow (PRs to `models.json` validated by CI)

## 6. Tech choices (defaults, change if you prefer)

| Area      | Choice                                | Why                                      |
| --------- | ------------------------------------- | ---------------------------------------- |
| Language  | TypeScript                            | One language across CLI, UI, extension   |
| Monorepo  | pnpm workspaces + Turborepo           | Fast, simple                             |
| CLI       | commander or cac                      | Small, stable                            |
| DB        | SQLite                                | Local, zero setup                        |
| Dashboard | React + Vite + Recharts               | Lightweight local app                    |
| Overlay   | Tauri                                 | Small cross-platform binaries            |
| Extension | WXT or plain MV3                      | Chrome + Firefox                         |
| Tests     | Vitest + fixtures of real log samples | Adapters break when tools change formats |

## 7. Risks and honest constraints

- **Subscription limits are only partly exposed.** Claude Code passes real 5h/7d percentages to the status line for Pro/Max (see section 0), and the meter uses them. Everywhere else (API-key users, other tools, the extension), the meter is an _estimate_ from local logs plus user-configured limits, marked with `~` in the UI.
- **Log formats change.** Each adapter needs fixture tests and a version-tolerant parser; fail soft, never crash the status line.
- **Status line must be fast.** Keep `burnrate statusline` under ~50ms (cache aggressively, no network calls in the hot path).
- **Pricing drifts.** Keep the pricing table data-only with a source URL and date, and show "pricing last updated" in the UI.
- **Do not scrape private web endpoints** or use session cookies for claude.ai or other web apps. It breaks ToS and is fragile. Extension meter should rely on the local estimate only.
- **API keys are sensitive.** Keychain only, redact in logs, admin-scope keys documented as optional.

## 8. Testing strategy

- Unit tests for cost math (table-driven, include cache tokens)
- Golden-file tests per adapter using anonymized real log samples in `fixtures/`
- Status line snapshot tests for each theme
- E2E: Playwright against the dashboard with seeded SQLite

## 9. Definition of done for v1

- Install in under 2 minutes on mac, Linux, Windows
- Live Claude Code meter + dashboard + calculator working offline
- API key tracking for at least Anthropic and OpenAI
- 3+ tools supported, adapter guide published
- README with GIF demos, MIT license, CI green

## 10. Instructions for Claude Code

- Work phase by phase; stop and summarize after each phase.
- Before writing code that depends on an external format or API (Claude Code statusLine schema, transcript JSONL fields, provider usage endpoints), check the current official docs and write down what you found in `docs/research.md`.
- Never hardcode secrets. Never log API keys.
- Every adapter ships with fixtures and tests.
- Keep the status line path dependency-light and fast.
- Ask me before adding any dependency that needs native compilation.
