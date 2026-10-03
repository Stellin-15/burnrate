# Research notes

What BurnRate depends on outside its own code, where it's documented, and what we found. Re-check these when something breaks or a tool updates.

_Last checked: 2026-10-03._

## Claude Code status line

Source: https://code.claude.com/docs/en/statusline

- **Config** (`~/.claude/settings.json`):
  `"statusLine": { "type": "command", "command": "...", "padding": 0, "refreshInterval": 60 }`.
  `refreshInterval` (seconds, min 1) is optional and re-runs the command on a timer in addition to events.
- **When it runs:** at session start, after each new assistant message, after `/compact`, on permission or vim mode changes, when a `rate_limits.*.resets_at` time passes, on `refreshInterval`. Updates are **debounced at 300 ms**. If a new update arrives while the script is still running, **the running script is cancelled**, so slow scripts show stale output.
- **Output:** each line of stdout is a row. ANSI colors and OSC 8 links work. stdout is captured, not a TTY, so `tput cols` doesn't work; Claude Code sets **`COLUMNS`** and `LINES` instead.
- **Windows:** commands run via Git Bash if installed, otherwise PowerShell. Backslashes in the command get eaten by Git Bash, so **use forward slashes**. `~` expands to the home dir.
- **Stdin JSON** fields BurnRate uses (all may be absent):
  - `model.id`, `model.display_name`
  - `cost.total_cost_usd`: client-side estimate at list price; resets on `/clear`
  - `context_window.used_percentage`: can be `null` early in a session; counts input tokens only
  - `rate_limits.five_hour.{used_percentage,resets_at}`, `rate_limits.seven_day.{…}`: **only for claude.ai Pro/Max subscribers**, only after the first API response in the session. Each window can be independently absent and is dropped once `resets_at` passes. `resets_at` is Unix epoch **seconds**.
  - `rate_limits.spend_limit.{used_percentage,resets_at,used_usd,limit_usd,period}`: only behind a Claude apps gateway with a spend limit. The `*_usd` fields can be missing even when the percentage is present.
  - `prompt_cache.hit_ratio`, `fast_mode`, `transcript_path`, `session_id`
- **Impact on the plan:** the original plan assumed subscription limits had no public "remaining" number and would always be estimates. **That's no longer true for Pro/Max in Claude Code.** BurnRate shows the real percentages when present and falls back to local estimates only when they're missing (API-key users, other tools, before the first response).

## Claude Code transcripts

Source: https://code.claude.com/docs/en/claude-directory (the line format itself is not formally documented)

- Location: `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`. With `CLAUDE_CONFIG_DIR` set, everything lives under that directory instead. On Windows `~` is `%USERPROFILE%`.
- Subagent transcripts: `projects/<project>/<session>/subagents/*.jsonl`. Large tool output: `projects/<project>/<session>/tool-results/` (not transcripts; skipped).
- Set-aside copies such as `<session>.orphaned-<ts>-<suffix>.jsonl` can duplicate lines from the main transcript. **Dedupe by message id + request id.**
- Retention: files older than `cleanupPeriodDays` (default 30) are deleted by Claude Code. Reports can't go back further than that unless BurnRate stores history (Phase 2, SQLite).
- Transcripts are not encrypted and can contain secrets. **BurnRate reads only usage fields and never stores content.**
- Assistant line shape, as BurnRate relies on it (fields beyond these are ignored):
  ```json
  {
    "type": "assistant",
    "timestamp": "2026-10-01T09:42:18.400Z",
    "sessionId": "…",
    "cwd": "/path/to/project",
    "requestId": "req_…",
    "message": {
      "id": "msg_…",
      "model": "claude-opus-5-5",
      "usage": {
        "input_tokens": 12,
        "output_tokens": 480,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 20000,
        "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 20000 }
      }
    }
  }
  ```
- One streamed response is written as **several lines with the same `message.id`**, one per content block. Only the last carries the final `output_tokens`. BurnRate keeps the line with the most output tokens per id.
- `model: "<synthetic>"` marks locally generated messages (e.g. API errors) and is never billed.
- `cache_creation` (split by TTL) may be missing in older versions. Then the combined `cache_creation_input_tokens` is priced at the 5-minute rate.
- Not yet verified: how fast-mode requests are marked in transcripts. The parser accepts `usage.speed === "fast"`. **TODO:** confirm against a real fast-mode transcript.
- Fixtures in `packages/adapters/claude-code/fixtures/` are **synthetic**, built from the shape above. Before release, validate the parser against a real (sanitized) transcript and update the fixtures if anything differs.

## Anthropic pricing

Source: https://platform.claude.com/docs/en/about-claude/pricing

- Per-MTok prices for input, 5-minute cache write (1.25× input), 1-hour cache write (2× input), cache read, and output. Copied verbatim into `packages/pricing/models.json`.
- Cache-read multiplier is **not** always 0.1×: Fable 5.1 / Mythos 5.1 are 0.025×, and Opus 5.5 is 0.05×. That's why `models.json` stores every rate explicitly instead of deriving it.
- Fast mode (Opus 5.5, Opus 5, Opus 4.8) replaces the input/output rates. Cache multipliers apply on top of the fast input rate.
- Not modeled yet: Batch API (50% off), data residency `inference_geo: "us"` (1.1×), regional Bedrock/Vertex premiums, web search ($10 per 1k searches). Claude Code doesn't use batch, so the status line is unaffected.

## Node built-in SQLite (`node:sqlite`)

- Available without a flag from Node 22.13; still marked experimental and prints an `ExperimentalWarning` on first load. BurnRate suppresses only that one warning (`packages/store/src/sqlite.ts`).
- API used: `DatabaseSync`, `prepare().run/get/all`, `exec`. Schema versions tracked with `PRAGMA user_version`; WAL mode plus `busy_timeout` because the dashboard, `report`, and `sync` may open the file at the same time.
- The status line never opens the database, so its speed is unaffected.

## Anthropic Usage & Cost Admin API

Source: https://platform.claude.com/docs/en/manage-claude/usage-cost-api and the API reference pages for `usage_report/messages` and `cost_report`.

- Needs an Admin API key (`sk-ant-admin01-…`), an `org:admin` OAuth token, or an organization-wide key. **Individual accounts can't use the Admin API.** Claude Enterprise uses a separate Analytics API (not supported yet).
- `GET /v1/organizations/usage_report/messages` with `x-api-key` and `anthropic-version: 2023-06-01`. `starting_at`/`ending_at` are RFC 3339; `bucket_width` is 1d (max 31 buckets per page), 1h (168), or 1m (1440). `group_by[]` includes `model` and `workspace_id`. Result fields: `uncached_input_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_5m_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`, `output_tokens`, `server_tool_use.web_search_requests`. No request counts.
- `GET /v1/organizations/cost_report`: daily only, max 31 buckets per page. **`amount` is a decimal string in cents** (`"123.45"` is $1.23). Grouping by `description` adds `model`, `token_type`, and `cost_type` (tokens, web_search, code_execution, session_usage). Priority Tier costs are not included.
- Pagination: `has_more` plus `next_page`, passed back as `page`. Data appears within about 5 minutes; polling once a minute is fine.

## OpenAI organization Usage and Costs APIs

Source: the official OpenAPI spec at github.com/openai/openai-openapi (`openapi.json`). The docs site blocks automated fetches.

- Admin key (`sk-admin-…`) sent as `Authorization: Bearer`.
- `GET /v1/organization/usage/completions`: `start_time`/`end_time` in **Unix seconds**, `bucket_width` 1m/1h/1d (1d max 31 per page), `group_by` includes `model` and `project_id`. **`input_tokens` includes cached and cache-write tokens**; `input_cached_tokens`, `input_cache_write_tokens` (30-minute), `input_cache_write_12h_tokens`, and `input_uncached_tokens` break it down. `num_model_requests` gives request counts.
- `GET /v1/organization/costs`: daily only, `limit` up to 180. `amount.value` is a number in `amount.currency` (lowercase ISO code). Grouping by `line_item` gives labels like `"gpt-5-2025-08-07, input"`.

## Not yet researched (later phases)

- OpenAI model prices (needed for "at list price" on OpenAI rows)
- Google (Gemini) usage: no simple usage API; cost data comes through a Cloud Billing export to BigQuery
- Codex CLI, Gemini CLI, OpenCode, and Aider log locations and formats (Phase 4)
