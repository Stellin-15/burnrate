# Changelog

## 0.4.0

First public release.

### Live meter for Claude Code

- Shows your real 5-hour and weekly Claude limits, when each resets, context usage, and cost, right in Claude Code's status line.
- Warns before you hit a limit ("⚠ limit in 48m"), based on how fast your usage is rising.
- Three themes (`default`, `minimal`, `plain`) and configurable widgets and thresholds.
- `burnrate init claude-code` sets it up and backs up your settings first; `burnrate uninstall claude-code` restores them.

### VS Code

- A BurnRate section in Claude Code's own sidebar, plus the same meter in VS Code's status bar.
- Session (5-hour) and weekly usage stay live while you use the chat panel, after one reading from Claude Code in a terminal.

### Dashboard and reports

- `burnrate dashboard`: a local web page with spend per day and model, budgets, plan limits, a model cost calculator, "what if" re-pricing, and CSV/JSON export.
- `burnrate report`: the same breakdowns in the terminal (daily, weekly, monthly, models, projects, sessions, 5-hour blocks).
- Usage history is kept in `~/.burnrate/burnrate.db`, so reports reach back further than Claude Code's 30-day transcript cleanup.

### API spend (optional)

- `burnrate keys add anthropic|openai` stores an organization Admin key in your OS keychain and loads 30 days of billed spend.
- `burnrate spend` compares what you were billed with list prices.

### Privacy

- No network access unless you add an API key. Everything is stored locally in `~/.burnrate`.
