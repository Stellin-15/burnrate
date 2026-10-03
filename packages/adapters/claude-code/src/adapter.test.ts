import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventCost } from "@burnrate/core";
import {
  claudeConfigDirs,
  listTranscriptFiles,
  loadClaudeCodeEvents,
  parseStatuslineInput,
  parseTranscript,
  parseTranscriptLine,
} from "./index.js";

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url);
const readFixture = (name: string) => readFileSync(fixture(name), "utf8");

/** Build a fake Claude config dir: <root>/projects/<project>/<files>. */
function fakeClaudeDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "burnrate-cc-"));
  for (const [rel, src] of Object.entries(files)) {
    const dest = join(root, "projects", rel);
    mkdirSync(join(dest, ".."), { recursive: true });
    copyFileSync(fixture(src), dest);
  }
  return root;
}

describe("parseTranscript (golden)", () => {
  it("matches the expected events for transcript-basic.jsonl", () => {
    const events = parseTranscript(readFixture("transcript-basic.jsonl"));
    expect(events).toEqual(JSON.parse(readFixture("transcript-basic.expected.json")));
  });

  it("prices the fixture as hand-computed", () => {
    const [sonnet, opus, fast] = parseTranscript(readFixture("transcript-basic.jsonl"));
    // Sonnet 4.5: 12*3 + 480*15 + 20000*6 (1h write) = 36 + 7200 + 120000 micro-dollars
    expect(eventCost(sonnet!)).toBeCloseTo(0.127236, 9);
    // Opus 5.5: 300*4 + 2000*20 + 50000*0.2 + 1000*5 = 1200 + 40000 + 10000 + 5000
    expect(eventCost(opus!)).toBeCloseTo(0.0562, 9);
    // Opus 5.5 fast: 1000*8 + 1000*40
    expect(eventCost(fast!)).toBeCloseTo(0.048, 9);
  });

  it("handles CRLF line endings", () => {
    const events = parseTranscript(readFixture("transcript-crlf.jsonl"));
    expect(events).toHaveLength(1);
    expect(events[0]!.project).toBe("C:\\work\\web");
  });
});

describe("parseTranscriptLine", () => {
  it.each([
    ["empty", ""],
    ["garbage", "hello"],
    ["truncated json", '{"type":"assistant","message":{'],
    ["json array", "[1,2]"],
    ["no usage", '{"timestamp":"2026-10-01T00:00:00Z","message":{"id":"m","model":"claude-opus-5-5"}}'],
    ["bad timestamp", '{"timestamp":"yesterday","message":{"id":"m","model":"claude-opus-5-5","usage":{"input_tokens":1}}}'],
    ["synthetic", '{"timestamp":"2026-10-01T00:00:00Z","message":{"id":"m","model":"<synthetic>","usage":{"input_tokens":1}}}'],
    ["all zero", '{"timestamp":"2026-10-01T00:00:00Z","message":{"id":"m","model":"claude-opus-5-5","usage":{"input_tokens":0}}}'],
  ])("skips %s without throwing", (_name, line) => {
    expect(parseTranscriptLine(line)).toBeUndefined();
  });

  it("ignores negative and non-numeric token counts", () => {
    const e = parseTranscriptLine(
      '{"timestamp":"2026-10-01T00:00:00Z","message":{"id":"m","model":"claude-opus-5-5","usage":{"input_tokens":-5,"output_tokens":"9","cache_read_input_tokens":10}}}',
    );
    expect(e).toMatchObject({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 10 });
  });

  it("falls back to the project dir name when cwd is missing", () => {
    const e = parseTranscriptLine(
      '{"timestamp":"2026-10-01T00:00:00Z","message":{"id":"m","model":"claude-opus-5-5","usage":{"input_tokens":1}}}',
      { projectDir: "-home-dev-app" },
    );
    expect(e?.project).toBe("-home-dev-app");
  });
});

describe("listTranscriptFiles / claudeConfigDirs", () => {
  it("finds session and subagent transcripts, skips tool-results", () => {
    const root = fakeClaudeDir({
      "-home-dev-acme/s1.jsonl": "transcript-basic.jsonl",
      "-home-dev-acme/s1/subagents/agent-1.jsonl": "transcript-crlf.jsonl",
      "-home-dev-acme/s1/tool-results/big.jsonl": "transcript-crlf.jsonl",
    });
    const files = listTranscriptFiles([root]).map((f) => f.path.replace(/\\/g, "/"));
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith("subagents/agent-1.jsonl"))).toBe(true);
  });

  it("honors CLAUDE_CONFIG_DIR and ignores dirs without projects/", () => {
    const root = fakeClaudeDir({ "p/s.jsonl": "transcript-crlf.jsonl" });
    const empty = mkdtempSync(join(tmpdir(), "burnrate-empty-"));
    const dirs = claudeConfigDirs([], { CLAUDE_CONFIG_DIR: `${root},${empty}`, XDG_CONFIG_HOME: empty });
    expect(dirs[0]).toBe(root);
    expect(dirs).not.toContain(empty);
  });
});

describe("loadClaudeCodeEvents", () => {
  it("dedupes the same request seen in two files (e.g. resumed session copies)", () => {
    const root = fakeClaudeDir({
      "p/a.jsonl": "transcript-basic.jsonl",
      "p/b.jsonl": "transcript-basic.jsonl",
    });
    expect(loadClaudeCodeEvents({ dirs: [root] })).toHaveLength(3);
  });

  it("filters by since", () => {
    const root = fakeClaudeDir({ "p/a.jsonl": "transcript-basic.jsonl" });
    const events = loadClaudeCodeEvents({ dirs: [root], since: new Date("2026-10-01T10:00:00Z") });
    expect(events.map((e) => e.id)).toEqual(["claude-code:msg_02:req_B", "claude-code:msg_03:req_C"]);
  });

  it("reads appended lines incrementally and waits for partial lines to finish", () => {
    const root = fakeClaudeDir({ "p/a.jsonl": "transcript-basic.jsonl" });
    const file = join(root, "projects", "p", "a.jsonl");
    const cachePath = join(root, "cache.json");

    expect(loadClaudeCodeEvents({ dirs: [root], cachePath })).toHaveLength(3);
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(Object.keys(cached.files)).toHaveLength(1);

    const line = readFixture("transcript-crlf.jsonl").trim();
    const half = Math.floor(line.length / 2);
    appendFileSync(file, line.slice(0, half)); // writer is mid-line
    expect(loadClaudeCodeEvents({ dirs: [root], cachePath })).toHaveLength(3);
    appendFileSync(file, line.slice(half) + "\n");
    expect(loadClaudeCodeEvents({ dirs: [root], cachePath })).toHaveLength(4);
  });

  it("reparses a file that was rewritten shorter", () => {
    const root = fakeClaudeDir({ "p/a.jsonl": "transcript-basic.jsonl" });
    const cachePath = join(root, "cache.json");
    loadClaudeCodeEvents({ dirs: [root], cachePath });
    writeFileSync(join(root, "projects", "p", "a.jsonl"), readFixture("transcript-crlf.jsonl"));
    expect(loadClaudeCodeEvents({ dirs: [root], cachePath }).map((e) => e.model)).toEqual(["claude-haiku-4-5-20251001"]);
  });

  it("survives a corrupt cache file", () => {
    const root = fakeClaudeDir({ "p/a.jsonl": "transcript-basic.jsonl" });
    const cachePath = join(root, "cache.json");
    writeFileSync(cachePath, "{not json");
    expect(loadClaudeCodeEvents({ dirs: [root], cachePath })).toHaveLength(3);
  });
});

describe("parseStatuslineInput", () => {
  it("reads rate limits from a Pro/Max payload", () => {
    const input = parseStatuslineInput(readFixture("statusline-pro.json"));
    expect(input.rate_limits?.five_hour?.used_percentage).toBe(72.4);
    expect(input.model?.id).toBe("claude-opus-5-5");
  });

  it("returns {} for empty or invalid stdin", () => {
    expect(parseStatuslineInput("")).toEqual({});
    expect(parseStatuslineInput("nope")).toEqual({});
    expect(parseStatuslineInput("[]")).toEqual({});
  });
});
