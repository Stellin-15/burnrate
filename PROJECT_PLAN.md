# BurnRate: Cross-Platform AI Usage Meter + Cost Dashboard

> Hand this file to Claude Code. Start with: "Read PROJECT_PLAN.md and build Phase 0 and Phase 1. Stop and summarize before Phase 2."

Repo name: `burnrate`
Alternate names if taken: `tokenmeter`, `spendline`, `gaugecode`, `limitlight`

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

TypeScript monorepo, pnpm workspaces, Node 20+.

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

- SQLite (better-sqlite3) at `~/.burnrate/burnrate.db`, deduped by event id
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

- **Subscription limits are not officially exposed.** Plan limits (Pro/Max style rolling windows) usually have no public "remaining" API, so the meter is an _estimate_ from local logs plus user-configured limits. Label it as an estimate in the UI.
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
