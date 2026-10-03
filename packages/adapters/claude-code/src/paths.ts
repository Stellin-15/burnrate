import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Claude Code config directories that contain a `projects/` folder.
 * Order: CLAUDE_CONFIG_DIR (comma-separated allowed), ~/.claude, ~/.config/claude, then `extra`.
 */
export function claudeConfigDirs(extra: string[] = [], env = process.env): string[] {
  const candidates = [
    ...(env.CLAUDE_CONFIG_DIR ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    join(homedir(), ".claude"),
    join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "claude"),
    ...extra,
  ];
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const c of candidates) {
    const abs = resolve(c.replace(/^~(?=$|[\\/])/, homedir()));
    const key = process.platform === "win32" ? abs.toLowerCase() : abs;
    if (seen.has(key)) continue;
    seen.add(key);
    if (existsSync(join(abs, "projects"))) dirs.push(abs);
  }
  return dirs;
}

/** The settings file Claude Code reads for user-level config (where statusLine lives). */
export function claudeSettingsPath(env = process.env): string {
  const first = (env.CLAUDE_CONFIG_DIR ?? "").split(",")[0]?.trim();
  return join(first || join(homedir(), ".claude"), "settings.json");
}

export interface TranscriptFile {
  path: string;
  /** Name of the projects/<dir> folder the file lives in (an encoded project path). */
  projectDir: string;
  size: number;
  mtimeMs: number;
}

/**
 * All transcript files (including subagent transcripts) under each dir's `projects/`,
 * modified at or after `sinceMs`. Unreadable entries are skipped silently.
 */
export function listTranscriptFiles(dirs: string[], sinceMs = 0): TranscriptFile[] {
  const out: TranscriptFile[] = [];
  const walk = (dir: string, projectDir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        // memory/ and tool-results/ never hold transcripts; skip them to keep the scan cheap.
        if (depth < 4 && ent.name !== "memory" && ent.name !== "tool-results") walk(p, projectDir, depth + 1);
      } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
        try {
          const st = statSync(p);
          if (st.mtimeMs >= sinceMs) out.push({ path: p, projectDir, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          // file vanished mid-scan
        }
      }
    }
  };
  for (const d of dirs) {
    const projects = join(d, "projects");
    let entries;
    try {
      entries = readdirSync(projects, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) if (ent.isDirectory()) walk(join(projects, ent.name), ent.name, 0);
  }
  return out;
}
