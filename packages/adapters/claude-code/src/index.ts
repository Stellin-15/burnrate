import type { Adapter, UsageEvent } from "@burnrate/core";
import { loadClaudeCodeEvents } from "./loader.js";
import { claudeConfigDirs } from "./paths.js";

export { loadClaudeCodeEvents, type LoadOptions } from "./loader.js";
export { mergeDuplicate, parseTranscript, parseTranscriptLine, type ParseContext } from "./parse.js";
export { claudeConfigDirs, claudeSettingsPath, listTranscriptFiles, type TranscriptFile } from "./paths.js";
export { parseStatuslineInput, type RateWindow, type StatuslineInput } from "./statusline-input.js";

export function createClaudeCodeAdapter(opts: { extraDirs?: string[]; cachePath?: string } = {}): Adapter {
  return {
    id: "claude-code",
    async detect() {
      return claudeConfigDirs(opts.extraDirs).length > 0;
    },
    async *readEvents(since: Date): AsyncIterable<UsageEvent> {
      yield* loadClaudeCodeEvents({ dirs: claudeConfigDirs(opts.extraDirs), since, cachePath: opts.cachePath });
    },
  };
}
