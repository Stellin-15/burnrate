# Writing an adapter

An adapter teaches BurnRate to read one tool's or provider's usage. Adding a tool means one new package plus pricing entries for its models. The core, CLI, and reports don't change.

## The contract

```ts
// packages/core/src/types.ts
interface Adapter {
  id: string; // "codex-cli"
  detect(): Promise<boolean>; // is this tool's data on this machine?
  readEvents(since: Date): AsyncIterable<UsageEvent>;
  watch?(onEvent: (e: UsageEvent) => void): () => void; // optional live updates
}

interface UsageEvent {
  id: string; // stable and unique: the same request must always get the same id
  timestamp: string; // ISO 8601
  tool: string; // your adapter id
  provider: string; // "anthropic" | "openai" | "google" | …
  model: string; // as the tool reports it; pricing normalizes it
  project?: string;
  sessionId?: string;
  inputTokens: number; // uncached input only
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number; // 5-minute TTL writes
  cacheWrite1hTokens?: number; // 1-hour TTL writes
  speed?: "standard" | "fast";
  reportedCostUsd?: number; // if the tool logs its own cost
  source: "local-log" | "provider-api" | "statusline";
}
```

## Steps

1. **Research first.** Find where the tool stores usage and what one record looks like. Link the official docs in [research.md](research.md) and note anything undocumented.
2. **Create the package:** `packages/adapters/<tool>/`, copying the structure of `adapters/claude-code` (`package.json`, `tsconfig*.json`, `src/`, `fixtures/`). Add a resolve alias in the root `vitest.config.ts`.
3. **Write fixtures before the parser.** Synthetic or sanitized records only: no prompts, code, file contents, or paths that identify a person. Include the awkward cases:
   - malformed and truncated lines
   - duplicate records for one request (streaming, retries, resumed sessions)
   - zero-usage and error records
   - every token field the tool reports (cache, reasoning, …)
   - CRLF line endings
4. **Parse defensively.** The parser must **never throw**. Skip anything unexpected. A tool update must degrade to missing numbers, not a crashed status line.
5. **Map tokens carefully.** Some tools report `input_tokens` _including_ cached tokens (OpenAI-style), while Anthropic reports them separately. `UsageEvent.inputTokens` must be **uncached input only**, or costs double-count.
6. **Make ids stable.** Prefer the provider's request or message id. Prefix with your adapter id (`codex-cli:…`) so ids never collide across tools.
7. **Add pricing** for any models not yet in `packages/pricing/models.json`, with `source` URLs.
8. **Test:** a golden test (fixture in, expected events out), a cost test with hand-computed numbers, and fault-tolerance tests. See `packages/adapters/claude-code/src/adapter.test.ts`.
9. **Wire it into the CLI** (`report`, `doctor`) and document it in the README.

## Performance

If the adapter feeds the status line, it must be fast on every message:

- Only read files modified since `since`.
- Read appended bytes, not whole files. `loader.ts` in the Claude Code adapter shows an incremental, offset-based cache you can reuse.
- No network calls.

## Checklist

- [ ] Research notes added to `docs/research.md`
- [ ] Fixtures cover malformed, duplicate, zero-usage, and CRLF cases
- [ ] Golden test plus a hand-checked cost test
- [ ] Parser never throws (fuzz it with garbage lines)
- [ ] `inputTokens` excludes cached tokens
- [ ] Pricing entries added with sources
