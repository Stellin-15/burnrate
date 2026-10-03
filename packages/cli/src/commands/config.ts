import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_CONFIG, THEMES, WIDGETS, loadConfig } from "@burnrate/core";

export async function runConfig(sub: string | undefined): Promise<number> {
  const loaded = loadConfig();
  switch (sub) {
    case "path":
      console.log(loaded.path);
      return 0;
    case "init": {
      if (existsSync(loaded.path)) {
        console.error(`${loaded.path} already exists. Edit it directly, or delete it and run this again.`);
        return 1;
      }
      mkdirSync(dirname(loaded.path), { recursive: true });
      writeFileSync(loaded.path, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
      console.log(`✓ Wrote ${loaded.path}`);
      console.log(`  Widgets: ${WIDGETS.join(", ")}`);
      console.log(`  Themes:  ${THEMES.join(", ")}`);
      return 0;
    }
    case "validate":
      if (!loaded.exists) console.log(`No config at ${loaded.path}; using defaults.`);
      else if (!loaded.warnings.length) console.log(`✓ ${loaded.path} is valid.`);
      for (const w of loaded.warnings) console.error(`✗ ${w}`);
      return loaded.warnings.length ? 1 : 0;
    case "show":
    case undefined:
      console.log(`# ${loaded.exists ? loaded.path : `defaults (no file at ${loaded.path})`}`);
      console.log(JSON.stringify(loaded.config, null, 2));
      for (const w of loaded.warnings) console.error(`warning: ${w}`);
      return 0;
    default:
      console.error(`Unknown subcommand "${sub}". Use: burnrate config [show|path|init|validate]`);
      return 2;
  }
}
