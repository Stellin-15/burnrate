# BurnRate

**A live usage-limit meter and cost reports for Claude Code. Local-first, no account, nothing leaves your machine.**

```
Opus 5.5 │ 5h ▰▰▰▰▰▰▱▱ 72% ↻1h12m ⚠ limit in 48m │ 7d 41% ↻3d4h │ ctx 31% │ $1.23 session │ $12.80 today
```

BurnRate answers two questions while you work:

1. **How much of my limit is left right now?** A meter in Claude Code's status line shows your 5-hour and weekly usage, when each resets, and warns you before you run out.
2. **What is this costing, and on which model?** `burnrate dashboard` opens a local web page with daily spend, budgets, and a model cost calculator. `burnrate report` gives the same breakdowns in the terminal.

Support for other tools (Codex CLI, Gemini CLI, OpenCode, Aider) and API-key spend tracking is on the [roadmap](#roadmap).

---

## Quick start

Requires **Node.js 20+** and Claude Code.

```sh
# 1. Get it (from source until the first npm release)
git clone <this-repo-url> burnrate && cd burnrate
corepack enable            # provides pnpm
pnpm install && pnpm build

# 2. Put `burnrate` on your PATH
pnpm --filter burnrate-cli pack --pack-destination .
npm install -g ./burnrate-cli-0.1.0.tgz

# 3. Add the meter to Claude Code
burnrate init claude-code
```

Send a message in Claude Code and the meter appears at the bottom of the screen. That's it.

> Once published, steps 1–2 become `npm install -g burnrate-cli`.

To preview the look without Claude Code:

```sh
burnrate statusline --demo
burnrate statusline --demo --theme minimal
burnrate statusline --demo --theme plain
```

## What the meter shows

| Widget        | Example                  | Where the number comes from                                                                                           |
| ------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `model`       | `Opus 5.5 ⚡`            | Claude Code (⚡ = fast mode)                                                                                          |
| `fiveHour`    | `5h ▰▰▰▰▰▰▱▱ 72% ↻1h12m` | **Pro/Max:** Claude Code's real rate-limit data. **Otherwise:** this 5-hour block's cost, or `~%` of a limit you set. |
| `sevenDay`    | `7d 41% ↻3d4h`           | Same as above, for the weekly window                                                                                  |
| `spendLimit`  | `spend $314/$500 63%`    | Claude Code, when an organization gateway sets a spend limit                                                          |
| `context`     | `ctx 31%`                | Claude Code: how full the context window is                                                                           |
| `sessionCost` | `$1.23 session`          | Claude Code's estimate for this session                                                                               |
| `todayCost`   | `$12.80 today`           | BurnRate, from local transcripts across all your sessions                                                             |
| `blockCost`   | `$4.10 block`            | BurnRate: spend in the current 5-hour block                                                                           |
| `burnRate`    | `$2.35/h`                | BurnRate: average spend rate in the current block                                                                     |
| `cache`       | `cache 91%`              | Claude Code: prompt-cache hit ratio                                                                                   |

**`⚠ limit in 48m`** appears when, at your current pace, you would hit the 5-hour or weekly limit before it resets. BurnRate projects this from how fast the percentage has been rising over the last hour.

Colors go green → yellow (60%) → red (85%). Both thresholds are configurable. If the terminal is narrow, widgets drop off the end so the line never wraps.

### How accurate is it?

- **Pro and Max subscribers:** the 5h and 7d percentages are **exact**. Claude Code passes them to the status line directly.
- **API-key users, or before your first message in a session:** there's no official "remaining" number. BurnRate shows what you've spent in the window instead. If you set your own limit in the config, it shows an **estimate**, marked with `~` (for example `5h ~40%`).
- **Dollar amounts** are API list-price equivalents from [`models.json`](packages/pricing/models.json), including cache reads/writes and fast mode. On a subscription you are not billed per token. Treat them as "what this would cost on the API".

## Reports

```sh
burnrate report                  # daily, last 30 days
burnrate report weekly
burnrate report monthly
burnrate report models           # most expensive models first
burnrate report projects
burnrate report sessions --limit 10
burnrate report blocks --since 2d   # 5-hour usage blocks
```

Example output:

```
Date        Requests  Input  Output  Cache read  Cache write    Cost
──────────  ────────  ─────  ──────  ──────────  ───────────  ──────
2026-10-01       412   1.3M    410k        182M         9.1M  $142.10
2026-10-02       388   1.1M    376k        165M         8.4M  $128.77
──────────  ────────  ─────  ──────  ──────────  ───────────  ──────
Total            800   2.4M    786k        347M          17M  $270.87
```

Options: `--since 2026-09-01` or `--since 7d`, `--until`, `--project <text>`, `--model <text>`, `--limit <n>`, and `--json` / `--csv` for spreadsheets or scripts.

## Dashboard

```sh
burnrate dashboard
```

This opens a page in your browser, served from your own machine:

![BurnRate dashboard: total spend, budget meters, and daily spend by model](docs/images/dashboard.png)

- **Usage:** total spend for the period, budget meters, what caching saved you, daily spend by model (with a table view), line items by model and project, and your most expensive sessions. Filter by 7 days, 30 days, 90 days, or all time, and by project or model. It refreshes every 30 seconds.
- **Cost calculator:** describe a workload, or start from your own average request, and see what it costs per request, day, and month on every model. **"What if"** re-prices your actual history on another model.
- **Export:** CSV for daily spend, models, projects, sessions, or every request; JSON for every request.
- **Budgets:** add `"budgets": { "daily": 25, "monthly": 400 }` to your config. Meters turn amber when you're on pace to go over and red when you have.

![Cost calculator comparing a workload across models](docs/images/calculator.png)

_Screenshots use synthetic demo data._

The dashboard binds to `127.0.0.1` only. Each run prints a link with a one-time token, and the page can't load data without it, so other websites and other users on your network can't read your usage. Options: `--port <n>`, `--no-open`.

## Configuration

Optional. Create a config file with defaults:

```sh
burnrate config init       # writes ~/.burnrate/config.json
burnrate config validate
```

```json
{
  "theme": "default",
  "widgets": ["model", "fiveHour", "sevenDay", "spendLimit", "context", "sessionCost", "todayCost"],
  "thresholds": { "warn": 60, "danger": 85 },
  "barWidth": 8,
  "limits": {},
  "budgets": {},
  "currency": { "code": "USD", "symbol": "$", "rateFromUsd": 1 },
  "cacheSeconds": 20,
  "claudeDirs": []
}
```

Every option, with examples (custom limits, other currencies, extra data dirs), is in [docs/configuration.md](docs/configuration.md). A broken config never breaks the status line: bad values fall back to defaults, and `burnrate config validate` tells you what's wrong.

## Commands

| Command                                        | What it does                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `burnrate init claude-code`                    | Add the meter to `~/.claude/settings.json` (backs up the file first) |
| `burnrate init claude-code --dry-run`          | Show what would change                                               |
| `burnrate init claude-code --force`            | Replace an existing custom status line (it can be restored later)    |
| `burnrate uninstall claude-code`               | Remove the meter and restore your previous status line               |
| `burnrate report [view]`                       | Usage and cost tables                                                |
| `burnrate dashboard`                           | Local web dashboard, budgets, and cost calculator                    |
| `burnrate statusline --demo [--theme <name>]`  | Preview the meter                                                    |
| `burnrate config [show\|path\|init\|validate]` | Manage the config file                                               |
| `burnrate doctor`                              | Check Node, Claude Code data, the installed status line, and pricing |

## Privacy

- BurnRate makes **no network requests**. The dashboard's fonts and scripts are bundled; it talks only to the local `burnrate dashboard` process.
- It reads Claude Code's transcripts under `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`) and keeps only token counts, model ids, timestamps, and project paths. It never stores message content.
- Its own files live in `~/.burnrate/` (override with `BURNRATE_HOME`): your config, a small cache, and an error log. Delete the folder at any time.
- `init` touches exactly one key, `statusLine`, in Claude Code's settings, and saves a timestamped backup next to the file first.

## Troubleshooting

- **The meter doesn't appear.** Run `burnrate doctor`. Then send a message in Claude Code; the status line refreshes on new messages.
- **The meter shows `burnrate: see ~/.burnrate/logs`.** Something failed. The error is in `~/.burnrate/logs/statusline-errors.log`. Please [open an issue](.github/ISSUE_TEMPLATE/bug_report.yml) with it.
- **No `5h %` shown.** You're on an API key, or Claude Code hasn't received a response yet this session. See [How accurate is it?](#how-accurate-is-it)
- **A model shows `$0.00`.** It's missing from the pricing table. `burnrate doctor` lists such models. A PR to `models.json` is very welcome.
- **Windows.** Supported. `init` writes forward-slash paths, so the command works whether Claude Code uses Git Bash or PowerShell.
- **Colors look wrong.** Try `"theme": "plain"`, or set `NO_COLOR=1`.

## Roadmap

| Phase | Status | Scope                                                                                         |
| ----- | ------ | --------------------------------------------------------------------------------------------- |
| 0     | ✅     | Monorepo, CI on macOS/Linux/Windows, tooling                                                  |
| 1     | ✅     | Pricing table, cost engine, Claude Code adapter, status line meter, reports, `init`           |
| 2     | ✅     | Local web dashboard (`burnrate dashboard`), budgets, and a multi-model "what if" calculator   |
| 3     | next   | API-key spend tracking (Anthropic, OpenAI, Google usage APIs), keys stored in the OS keychain |
| 4     |        | Codex CLI, Gemini CLI, OpenCode, and Aider adapters; desktop overlay; browser extension       |
| 5     |        | Theme packs, layout editor, docs site, Homebrew/winget/scoop                                  |

The full plan is in [PROJECT_PLAN.md](PROJECT_PLAN.md).

## Contributing

Pricing fixes, new adapters, and bug reports with (sanitized) sample log lines are the most valuable contributions. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/writing-an-adapter.md](docs/writing-an-adapter.md).

## License

[MIT](LICENSE)
