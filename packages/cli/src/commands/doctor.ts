import { existsSync, readFileSync } from "node:fs";
import { burnrateHome, loadConfig, sumEvents } from "@burnrate/core";
import { findModelPricing, pricingTable } from "@burnrate/pricing";
import {
  claudeConfigDirs,
  claudeSettingsPath,
  listTranscriptFiles,
  loadClaudeCodeEvents,
} from "@burnrate/adapter-claude-code";

/** Print an environment health check. Exits 1 only if something blocks the meter from working. */
export async function runDoctor(): Promise<number> {
  let problems = 0;
  const ok = (s: string) => console.log(`  ✓ ${s}`);
  const warn = (s: string) => console.log(`  ! ${s}`);
  const bad = (s: string) => {
    problems++;
    console.log(`  ✗ ${s}`);
  };

  console.log("Environment");
  const major = Number(process.versions.node.split(".")[0]);
  (major >= 20 ? ok : bad)(`Node ${process.versions.node}${major >= 20 ? "" : " (BurnRate needs Node 20+)"}`);
  ok(`BurnRate data dir: ${burnrateHome()}`);

  console.log("\nConfig");
  const cfg = loadConfig();
  if (!cfg.exists) ok(`No config file (using defaults). Create one with: burnrate config init`);
  else if (cfg.warnings.length) cfg.warnings.forEach((w) => warn(w));
  else ok(`${cfg.path} is valid`);

  console.log("\nClaude Code");
  const dirs = claudeConfigDirs(cfg.config.claudeDirs);
  if (!dirs.length)
    bad("No Claude Code data dir found (looked for ~/.claude/projects, CLAUDE_CONFIG_DIR, ~/.config/claude)");
  for (const d of dirs) ok(`Data dir: ${d}`);

  const settingsPath = claudeSettingsPath();
  let statusLine: { command?: string } | undefined;
  try {
    statusLine = existsSync(settingsPath)
      ? JSON.parse(readFileSync(settingsPath, "utf8")).statusLine
      : undefined;
  } catch {
    bad(`${settingsPath} is not valid JSON`);
  }
  if (statusLine?.command && /burnrate/i.test(statusLine.command))
    ok(`Status line installed: ${statusLine.command}`);
  else if (statusLine)
    warn(`A different status line is configured. Replace it with: burnrate init claude-code --force`);
  else warn(`Status line not installed. Run: burnrate init claude-code`);

  if (dirs.length) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const files = listTranscriptFiles(dirs, since.getTime());
    ok(`${files.length} transcript file(s) active in the last 30 days`);
    const started = Date.now();
    const events = loadClaudeCodeEvents({ dirs, since });
    const totals = sumEvents(events);
    ok(`${totals.requests} request(s) parsed in ${Date.now() - started}ms`);
    const unknown = totals.models.filter((m) => !findModelPricing(m));
    if (unknown.length)
      warn(`Models without pricing (cost shown as $0): ${unknown.join(", ")}. PRs to models.json welcome.`);
    else if (totals.requests) ok("Every model seen has pricing");
  }

  console.log("\nPricing");
  const ageDays = Math.floor((Date.now() - Date.parse(pricingTable.updatedAt)) / 86_400_000);
  (ageDays > 90 ? warn : ok)(
    `Pricing table updated ${pricingTable.updatedAt} (${ageDays} days ago), ${pricingTable.models.length} models`,
  );

  console.log(problems ? `\n${problems} problem(s) found.` : "\nAll good.");
  return problems ? 1 : 0;
}
