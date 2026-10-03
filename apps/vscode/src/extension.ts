import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { burnrateHome, loadConfig } from "@burnrate/core";
import type { StatusSnapshot } from "../../../packages/cli/src/snapshot.js";
import { getLocalSummary, readJson } from "../../../packages/cli/src/summary.js";
import { buildView, dashboardLaunch, type StatusView } from "./view.js";

let item: vscode.StatusBarItem | undefined;
let timer: NodeJS.Timeout | undefined;
let watcher: FSWatcher | undefined;

/**
 * The BurnRate section inside Claude Code's own sidebar (next to the chat). Extensions can't draw inside
 * another extension's chat view, but they can add a view to its container, which is the closest place.
 */
const SIDEBAR_VIEWS = ["burnrate.claudeSidebarSecondary", "burnrate.claudeSidebar"] as const;

class MeterTree implements vscode.TreeDataProvider<StatusView["rows"][number]> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  rows: StatusView["rows"] = [];
  update(rows: StatusView["rows"]) {
    this.rows = rows;
    this.changed.fire();
  }
  getChildren() {
    return this.rows;
  }
  getTreeItem(r: StatusView["rows"][number]): vscode.TreeItem {
    const t = new vscode.TreeItem(r.label);
    t.description = r.value;
    t.tooltip = `${r.label}: ${r.value}`;
    const color =
      r.level === "error" ? "charts.red" : r.level === "warning" ? "charts.yellow" : "charts.green";
    const isLimit = r.id === "fiveHour" || r.id === "sevenDay" || r.id === "spendLimit";
    t.iconPath = new vscode.ThemeIcon(
      isLimit ? "circle-filled" : "graph",
      isLimit ? new vscode.ThemeColor(color) : undefined,
    );
    t.command = { command: "burnrate.openDashboard", title: "Open BurnRate dashboard" };
    return t;
  }
  dispose() {
    this.changed.dispose();
  }
}

const tree = new MeterTree();
const treeViews: vscode.TreeView<StatusView["rows"][number]>[] = [];

function settings() {
  const c = vscode.workspace.getConfiguration("burnrate");
  return {
    refreshSeconds: Math.max(5, c.get<number>("refreshSeconds", 30)),
    showTodayCost: c.get<boolean>("showTodayCost", true),
    dashboardCommand: c.get<string>("dashboardCommand", "").trim(),
  };
}

function refresh(): void {
  if (!item) return;
  try {
    const home = burnrateHome();
    const { config } = loadConfig();
    const snapshot = readJson<StatusSnapshot>(join(home, "state", "last-status.json"));
    // Same cached, incremental transcript summary the status line uses: cheap after the first read.
    const local = getLocalSummary(config, home, new Date());
    const view = buildView(snapshot, local, config, { showTodayCost: settings().showTodayCost });
    item.text = view.text;
    const md = new vscode.MarkdownString(view.tooltip);
    md.isTrusted = { enabledCommands: ["burnrate.openDashboard", "burnrate.refresh"] };
    item.tooltip = md;
    for (const v of treeViews) {
      // The header line shows the meter even while the section is collapsed.
      v.description = view.headline;
      v.message = view.hint;
    }
    tree.update(view.rows);
    item.backgroundColor =
      view.level === "error"
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : view.level === "warning"
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
  } catch (err) {
    item.text = "$(pulse) BurnRate";
    item.tooltip = `BurnRate couldn't read usage: ${(err as Error).message}`;
    item.backgroundColor = undefined;
  }
  item.show();
}

function claudeStatusLineCommand(): string | undefined {
  const dir = (process.env.CLAUDE_CONFIG_DIR ?? "").split(",")[0]?.trim() || join(homedir(), ".claude");
  const file = join(dir, "settings.json");
  if (!existsSync(file)) return undefined;
  try {
    const cmd = JSON.parse(readFileSync(file, "utf8"))?.statusLine?.command;
    return typeof cmd === "string" ? cmd : undefined;
  } catch {
    return undefined;
  }
}

async function openDashboard(): Promise<void> {
  const custom = settings().dashboardCommand;
  const existing = vscode.window.terminals.find((t) => t.name === "BurnRate dashboard");
  if (existing) {
    existing.show();
    return;
  }
  if (custom) {
    const t = vscode.window.createTerminal({ name: "BurnRate dashboard" });
    t.sendText(custom);
    t.show();
    return;
  }
  const launch = dashboardLaunch(claudeStatusLineCommand());
  if (launch) {
    // Run node directly (no shell), so quoting works the same in PowerShell, cmd, and bash.
    vscode.window.createTerminal({ name: "BurnRate dashboard", ...launch }).show();
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "BurnRate isn't set up for Claude Code yet. Run `burnrate init claude-code`, or set burnrate.dashboardCommand.",
    "Open settings",
  );
  if (choice)
    void vscode.commands.executeCommand("workbench.action.openSettings", "burnrate.dashboardCommand");
}

function schedule(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(refresh, settings().refreshSeconds * 1000);
}

/** Refresh as soon as the status line saves new plan limits, instead of waiting for the timer. */
function watchSnapshot(): void {
  const dir = join(burnrateHome(), "state");
  if (!existsSync(dir)) return;
  let pending: NodeJS.Timeout | undefined;
  try {
    watcher = watch(dir, (_event, file) => {
      if (file && !String(file).startsWith("last-status")) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(refresh, 300);
    });
  } catch {
    // Watching is an optimization; the timer still refreshes.
  }
}

export function activate(context: vscode.ExtensionContext): void {
  item = vscode.window.createStatusBarItem("burnrate.meter", vscode.StatusBarAlignment.Right, 100);
  item.name = "BurnRate";
  item.command = "burnrate.openDashboard";
  item.text = "$(pulse) BurnRate";
  item.show();

  for (const id of SIDEBAR_VIEWS) {
    const v = vscode.window.createTreeView(id, { treeDataProvider: tree });
    // Re-read as soon as the section is shown, so it is never stale when you open it.
    v.onDidChangeVisibility((e) => e.visible && refresh());
    treeViews.push(v);
  }

  context.subscriptions.push(
    tree,
    ...treeViews,
    item,
    vscode.commands.registerCommand("burnrate.refresh", refresh),
    vscode.commands.registerCommand("burnrate.openDashboard", openDashboard),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("burnrate")) {
        schedule();
        refresh();
      }
    }),
    { dispose: () => timer && clearInterval(timer) },
    { dispose: () => watcher?.close() },
  );

  // The first transcript read can take a moment; let VS Code finish starting up first.
  setTimeout(refresh, 1500);
  schedule();
  watchSnapshot();
}

export function deactivate(): void {
  if (timer) clearInterval(timer);
  watcher?.close();
}
