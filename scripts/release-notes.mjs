// Prints the CHANGELOG.md section for a version, for the GitHub Release body.
//   node scripts/release-notes.mjs v0.4.0
import { readFileSync } from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const start = changelog.indexOf(`## ${version}`);
if (!version || start < 0) {
  console.error(`No "## ${version}" section in CHANGELOG.md`);
  process.exit(1);
}
const rest = changelog.slice(start);
const next = rest.indexOf("\n## ", 3);
const section = (next < 0 ? rest : rest.slice(0, next)).split("\n").slice(1).join("\n").trim();

const repo = "https://github.com/Stellin-15/burnrate";
console.log(`${section}

## Install

**Command line** (needs [Node.js 22.13+](https://nodejs.org)):

\`\`\`sh
npm install -g ${repo}/releases/download/v${version}/burnrate-cli.tgz
burnrate init claude-code
\`\`\`

**VS Code:** download \`burnrate-vscode.vsix\` below, then run \`code --install-extension burnrate-vscode.vsix\` (or use *Extensions → … → Install from VSIX*).

See the [README](${repo}#readme) for everything else.`);
