import { closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { UsageEvent } from "@burnrate/core";
import { mergeDuplicate, parseTranscriptLine } from "./parse.js";
import { listTranscriptFiles, type TranscriptFile } from "./paths.js";

const CACHE_VERSION = 1;

interface FileEntry {
  size: number;
  mtimeMs: number;
  /** Byte offset just past the last complete line parsed. */
  offset: number;
  events: UsageEvent[];
}

interface CacheFile {
  version: number;
  /** Events before this were pruned; a request reaching further back must reparse. */
  sinceMs: number;
  files: Record<string, FileEntry>;
}

export interface LoadOptions {
  /** Claude config dirs to scan (see claudeConfigDirs()). */
  dirs: string[];
  /** Only include events at or after this time. Files untouched since then are skipped entirely. */
  since?: Date;
  /** Persist parsed results here and re-read only appended bytes next time. */
  cachePath?: string;
}

/** Read bytes [from, to) of a file. */
function readRange(path: string, from: number, to: number): Buffer {
  const buf = Buffer.alloc(to - from);
  const fd = openSync(path, "r");
  try {
    let read = 0;
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, from + read);
      if (n === 0) break;
      read += n;
    }
    return read === buf.length ? buf : buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** Parse new complete lines in `file` starting at `entry.offset`, appending to entry.events. */
function parseAppended(file: TranscriptFile, entry: FileEntry): FileEntry {
  const chunk = readRange(file.path, entry.offset, file.size);
  // Only consume through the last newline: a line still being written is picked up next time.
  const lastNl = chunk.lastIndexOf(10);
  if (lastNl < 0) return { ...entry, size: file.size, mtimeMs: file.mtimeMs };
  const text = chunk.subarray(0, lastNl + 1).toString("utf8");
  const byId = new Map(entry.events.map((e) => [e.id, e]));
  for (const line of text.split(/\r?\n/)) {
    const e = parseTranscriptLine(line, { projectDir: file.projectDir });
    if (e) byId.set(e.id, mergeDuplicate(byId.get(e.id), e));
  }
  return {
    size: file.size,
    mtimeMs: file.mtimeMs,
    offset: entry.offset + lastNl + 1,
    events: [...byId.values()],
  };
}

function readCache(path: string | undefined): CacheFile {
  if (!path) return { version: CACHE_VERSION, sinceMs: 0, files: {} };
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
    if (
      c.version === CACHE_VERSION &&
      typeof c.sinceMs === "number" &&
      c.files &&
      typeof c.files === "object"
    )
      return c;
  } catch {
    // missing or corrupt cache: rebuild
  }
  return { version: CACHE_VERSION, sinceMs: 0, files: {} };
}

function writeCache(path: string, cache: CacheFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, path);
  } catch {
    // Cache is an optimization. Another process may hold it (Windows), or the disk may be read-only.
  }
}

/**
 * Load Claude Code usage events from local transcripts, deduped across files.
 * With `cachePath`, unchanged files cost nothing and growing files are read incrementally.
 */
export function loadClaudeCodeEvents(opts: LoadOptions): UsageEvent[] {
  const sinceMs = opts.since?.getTime() ?? 0;
  const files = listTranscriptFiles(opts.dirs, sinceMs);
  let cache = readCache(opts.cachePath);
  if (sinceMs < cache.sinceMs) cache = { version: CACHE_VERSION, sinceMs: 0, files: {} };
  const next: CacheFile = { version: CACHE_VERSION, sinceMs, files: {} };
  let dirty = false;

  for (const file of files) {
    let entry = cache.files[file.path];
    if (!entry || file.size < entry.offset || (file.size === entry.size && file.mtimeMs !== entry.mtimeMs)) {
      // New, truncated, or rewritten in place: parse from scratch.
      entry = { size: 0, mtimeMs: 0, offset: 0, events: [] };
    }
    if (file.size !== entry.size || file.mtimeMs !== entry.mtimeMs) {
      try {
        entry = parseAppended(file, entry);
        dirty = true;
      } catch {
        continue; // unreadable right now; try again next run
      }
    }
    // Drop events older than the window so the cache stays small.
    if (sinceMs) entry = { ...entry, events: entry.events.filter((e) => Date.parse(e.timestamp) >= sinceMs) };
    next.files[file.path] = entry;
  }
  if (Object.keys(cache.files).length !== Object.keys(next.files).length) dirty = true;
  if (opts.cachePath && dirty) writeCache(opts.cachePath, next);

  const byId = new Map<string, UsageEvent>();
  for (const entry of Object.values(next.files))
    for (const e of entry.events) byId.set(e.id, mergeDuplicate(byId.get(e.id), e));
  return [...byId.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
