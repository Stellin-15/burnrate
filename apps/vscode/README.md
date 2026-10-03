# BurnRate for VS Code

Your Claude Code usage limits and today's cost in the VS Code status bar.

```
$(pulse) 5h 39% ↻ 2h16m │ 7d 37% │ $46.12 today
```

- **5h / 7d:** your real Claude plan limits (Pro and Max), as reported by Claude Code, with the time until the 5-hour window resets. The item turns amber at 60% and red at 85% (configurable in `~/.burnrate/config.json`).
- **Today:** what today's Claude Code usage would cost at API list prices.
- **Hover** for details: weekly reset, current 5-hour block, burn rate, and the last 7 days.
- **Click** to open the BurnRate dashboard.

## Requirements

[BurnRate](https://github.com/Stellin-15/burnrate) set up for Claude Code (`burnrate init claude-code`).

The Claude Code chat panel doesn't report plan limits, so they come from the BurnRate status line. They refresh whenever Claude Code runs in a terminal, and the status bar updates within a second. Between those runs, it shows the last known limits until their window resets. Today's cost is read from Claude Code's local transcripts every 30 seconds.

## Privacy

The extension reads only local files (`~/.burnrate` and Claude Code's transcripts) and makes no network requests.

## Settings

| Setting                     | Default |                                                         |
| --------------------------- | ------- | ------------------------------------------------------- |
| `burnrate.refreshSeconds`   | `30`    | How often to re-read usage                              |
| `burnrate.showTodayCost`    | `true`  | Show today's cost in the status bar                     |
| `burnrate.dashboardCommand` | `""`    | Command that starts the dashboard, if not auto-detected |
