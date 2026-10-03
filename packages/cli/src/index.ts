import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { REPORT_VIEWS, type ReportView } from "./commands/report.js";

const HELP = `burnrate ${pkg.version}: AI usage meter and cost reports (local-first)

Usage
  burnrate init claude-code [--dry-run] [--force]   Add the meter to Claude Code's status line
  burnrate uninstall claude-code                     Remove it (restores any previous status line)
  burnrate report [view] [options]                   Usage and cost tables
  burnrate statusline                                Render the meter (Claude Code runs this)
  burnrate statusline --demo [--theme <name>]        Preview the meter with sample data
  burnrate config [show|path|init|validate]          Manage ~/.burnrate/config.json
  burnrate doctor                                    Check your setup

Report views
  ${REPORT_VIEWS.join(", ")}   (default: daily)

Report options
  --since <date>    YYYY-MM-DD or relative (7d, 12h). Default: 30 days (weekly 12 weeks, monthly 1 year)
  --until <date>    YYYY-MM-DD (inclusive) or relative
  --project <text>  Only projects whose path contains <text>
  --model <text>    Only models whose id contains <text>
  --limit <n>       Most recent n rows (time views) or top n rows (others)
  --json | --csv    Machine-readable output

Config: ~/.burnrate/config.json (see \`burnrate config init\`). NO_COLOR is respected.`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      json: { type: "boolean" },
      csv: { type: "boolean" },
      since: { type: "string" },
      until: { type: "string" },
      project: { type: "string" },
      model: { type: "string" },
      limit: { type: "string" },
      demo: { type: "boolean" },
      theme: { type: "string" },
      force: { type: "boolean" },
      "dry-run": { type: "boolean" },
      command: { type: "string" },
      refresh: { type: "string" },
    },
  });
  const [cmd, sub] = positionals;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  if (values.version) {
    console.log(pkg.version);
    return 0;
  }
  if (values.help || !cmd || cmd === "help") {
    console.log(HELP);
    return 0;
  }

  switch (cmd) {
    case "statusline": {
      const { runStatusline } = await import("./commands/statusline.js");
      return runStatusline({ demo: !!values.demo, theme: str(values.theme) });
    }
    case "report": {
      const view = (sub ?? "daily") as ReportView;
      if (!REPORT_VIEWS.includes(view)) {
        console.error(`Unknown report view "${sub}". Choose one of: ${REPORT_VIEWS.join(", ")}`);
        return 2;
      }
      const limit = str(values.limit) ? Number(values.limit) : undefined;
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
        console.error("--limit must be a positive integer");
        return 2;
      }
      const { runReport } = await import("./commands/report.js");
      return runReport({
        view,
        since: str(values.since),
        until: str(values.until),
        project: str(values.project),
        model: str(values.model),
        format: values.json ? "json" : values.csv ? "csv" : "table",
        limit,
      });
    }
    case "init": {
      const refresh = str(values.refresh) ? Number(values.refresh) : undefined;
      if (refresh !== undefined && !(Number.isInteger(refresh) && refresh >= 1)) {
        console.error("--refresh must be a whole number of seconds >= 1");
        return 2;
      }
      const { runInit } = await import("./commands/init.js");
      return runInit({
        tool: sub,
        force: !!values.force,
        dryRun: !!values["dry-run"],
        command: str(values.command),
        refresh,
      });
    }
    case "uninstall": {
      const { runUninstall } = await import("./commands/init.js");
      return runUninstall({ tool: sub });
    }
    case "config": {
      const { runConfig } = await import("./commands/config.js");
      return runConfig(sub);
    }
    case "doctor": {
      const { runDoctor } = await import("./commands/doctor.js");
      return runDoctor();
    }
    default:
      console.error(`Unknown command "${cmd}". Run \`burnrate --help\`.`);
      return 2;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
