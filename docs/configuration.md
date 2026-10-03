# Configuration

BurnRate works without any config. To customize it:

```sh
burnrate config init       # writes ~/.burnrate/config.json with defaults
burnrate config show       # prints the effective config
burnrate config validate   # explains anything invalid
```

Invalid values never break the status line: each one falls back to its default, and `validate` reports it.

## Locations

| What                                 | Default                         | Override                                                       |
| ------------------------------------ | ------------------------------- | -------------------------------------------------------------- |
| Config file                          | `~/.burnrate/config.json`       | `BURNRATE_CONFIG=/path/to/config.json`                         |
| Cache, logs, history (`burnrate.db`) | `~/.burnrate/`                  | `BURNRATE_HOME=/path`                                          |
| Claude Code data                     | `~/.claude`, `~/.config/claude` | `CLAUDE_CONFIG_DIR` (comma-separated allowed), or `claudeDirs` |

## Options

### `theme`

`"default"` (colors and bars), `"minimal"` (colors, no bars), or `"plain"` (no colors, ASCII only, for terminals that render Unicode poorly).

`NO_COLOR=1` turns colors off in every theme.

### `widgets`

The widgets to show, in order. Widgets with no data are skipped automatically. If the terminal is too narrow, widgets are dropped from the **end**, so put the ones you care about most first.

| Id            | Shows                                                    |
| ------------- | -------------------------------------------------------- |
| `model`       | Current model; ⚡ in fast mode                           |
| `fiveHour`    | 5-hour window: real % (Pro/Max), estimate, or block cost |
| `sevenDay`    | 7-day window, same rules                                 |
| `spendLimit`  | Organization spend limit (gateway users only)            |
| `context`     | Context window usage                                     |
| `sessionCost` | This session's cost                                      |
| `todayCost`   | Today's cost across all Claude Code sessions             |
| `blockCost`   | Cost in the current 5-hour block                         |
| `burnRate`    | Spend per hour in the current block                      |
| `cache`       | Prompt-cache hit ratio                                   |

Default: `["model", "fiveHour", "sevenDay", "spendLimit", "context", "sessionCost", "todayCost"]`

### `thresholds`

`{ "warn": 60, "danger": 85 }`. Percentages where widgets turn yellow and then red. `warn` must be lower than `danger`.

### `barWidth`

Characters in the 5h bar, 3–40. Default `8`.

### `limits`

**Only used when Claude Code doesn't report real limits**: API-key users, or before the first response in a session. Set your own budget per window, as a dollar cost or a token count:

```json
{
  "limits": {
    "fiveHour": { "costUsd": 20 },
    "sevenDay": { "costUsd": 150 }
  }
}
```

The meter then shows `5h ~45%` (the `~` means estimate) and warns `⚠ limit in 30m` if you're on pace to exceed it before the window resets.

How the windows are computed:

- **5-hour:** a block starts at the top of the hour of your first request and lasts 5 hours. The first request after it ends starts a new block. This mirrors how subscription session windows behave, but it is an approximation.
- **7-day:** a rolling sum of the last 7 days.
- **Tokens** count input, output, cache reads, and cache writes. Cost is usually the better unit, because cache reads are numerous but cheap.

### `currency`

BurnRate never fetches exchange rates. You set the rate:

```json
{ "currency": { "code": "EUR", "symbol": "€", "rateFromUsd": 0.92 } }
```

### `budgets`

Spending caps in USD per calendar day, week (starting Monday), and month, in local time. Shown as meters in `burnrate dashboard`:

```json
{ "budgets": { "daily": 25, "weekly": 120, "monthly": 400 } }
```

A meter turns amber at 80% or when your current pace would exceed the budget by the end of the period, and red once you're over. Pace isn't projected during the first hour of a period, because one early request would make the estimate meaningless. Budgets always count all your usage, whatever filters the dashboard has on.

### `cacheSeconds`

How long the status line reuses its last transcript scan. Default `20`. Real rate-limit numbers from Claude Code are always live; this only affects `todayCost`, `blockCost`, `burnRate`, and estimates.

### `claudeDirs`

Extra Claude Code config directories to scan (each must contain `projects/`), e.g. a second machine's synced folder:

```json
{ "claudeDirs": ["~/backups/laptop-claude"] }
```

## Examples

See [`examples/`](../examples):

- [`config.minimal.json`](../examples/config.minimal.json): a compact meter with just limits and today's spend
- [`config.api-user.json`](../examples/config.api-user.json): API-key users with their own budgets and a burn-rate readout
- [`config.everything.json`](../examples/config.everything.json): every widget, plain theme, a non-USD currency
