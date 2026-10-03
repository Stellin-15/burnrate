# Contributing to BurnRate

Thanks for helping. Bug reports, pricing fixes, and new adapters matter most.

## Setup

```sh
corepack enable        # provides the pinned pnpm version
pnpm install
pnpm build             # builds every package; the CLI bundles to packages/cli/dist/cli.js
pnpm test              # Vitest, runs against TypeScript sources (no build needed)
pnpm check             # everything CI runs: lint, format check, pricing validation, typecheck, tests
```

Try your local build:

```sh
node packages/cli/dist/cli.js statusline --demo
node packages/cli/dist/cli.js report models
```

To try it in Claude Code without changing your installed version, point a throwaway `CLAUDE_CONFIG_DIR` at a test folder, or use `init --dry-run`.

## Layout

```
packages/
  pricing/              models.json + validator + lookup. Data only, no logic about tools.
  core/                 UsageEvent schema, cost engine, rolling-window estimator, config, formatting
  adapters/claude-code/ transcript discovery + parsing, status line input types
  cli/                  `burnrate` binary: statusline, report, init/uninstall, config, doctor
docs/                   research notes, configuration reference, adapter guide
```

Dependencies only point downward: `cli → adapters → core → pricing`. The CLI bundles everything into a single file with **no runtime dependencies**, because Claude Code runs it after every message.

## Ground rules

- **Never crash the status line.** Parsers skip bad input; the status line catches everything and logs it to `~/.burnrate/logs`.
- **Keep the hot path fast.** No network calls in `statusline`, and avoid new dependencies in `core`, `adapters`, or `cli`. Ask in an issue before adding any dependency that needs native compilation.
- **Every adapter ships with fixtures and tests.** Tools change their log formats; fixtures are how we notice.
- **No real user data in fixtures.** Write synthetic lines or strip content down to ids, timestamps, models, and usage.
- **Never log or store secrets or message content.**
- **Check the docs before depending on an external format**, and write down what you found in [docs/research.md](docs/research.md).

## Updating prices

1. Edit `packages/pricing/models.json`. Each entry needs `source` (the provider's official pricing URL) and `updatedAt`.
2. Run `pnpm validate:pricing && pnpm test`.
3. If a published price changed, update any hand-checked numbers in `packages/core/src/cost.test.ts`.

Model ids are matched exactly after normalization (date suffixes and Bedrock/Vertex prefixes are stripped), never by prefix. So `claude-opus-4` will never match `claude-opus-4-5`. Use `aliases` for alternative spellings.

## Releasing

User-facing changes need a changeset: `pnpm changeset`. Only `burnrate-cli` is published; the `@burnrate/*` packages are bundled into it.

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/): `feat(cli): …`, `fix(claude-code): …`, `docs: …`.
