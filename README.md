# claudex

`claudex` is a Bun-based launcher that runs Claude Code against an OpenAI-compatible endpoint.

You can download binaries from [Releases](https://github.com/EdamAme-x/claudex/releases).

## Local usage

0. Install dependencies:

```bash
bun install
```

1. Ensure Codex config files exist:

```text
~/.codex/config.toml
~/.codex/auth.json
```

2. Run:

```bash
./claudex
```

Wrapper flags:

- `--no-safe`: disables `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` for that run.
- By default, `claudex` enables safe mode (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`).

Optional environment variables:

- `CLAUDEX_FORCE_MODEL` (default: value of `model` from `~/.codex/config.toml`; fallback: `gpt-5.3-codex`)
- `CLAUDEX_DEFAULT_REASONING_EFFORT` (default: `xhigh`)
- `CLAUDEX_CLAUDE_BIN`
- `CLAUDEX_CODEX_CONFIG` (overrides `~/.codex/config.toml`)
- `CLAUDEX_CODEX_AUTH` (overrides `~/.codex/auth.json`)
- `CLAUDEX_MODEL_PROVIDER` (overrides `model_provider` selection)
- `CLAUDEX_UPSTREAM_BASE_URL` (force endpoint URL)
- `CLAUDEX_UPSTREAM_API_KEY` (force API key)
- `CLAUDEX_FORCE_LOGIN_METHOD` (default: `console`; set to `none` to disable injection)
- `CLAUDEX_PORT`
- `CLAUDEX_DEBUG=1`

Authentication note:

- `claudex` sets `ANTHROPIC_API_KEY` to your upstream API key and, unless you pass `--settings` yourself, injects `--settings {"forceLoginMethod":"console"}` to avoid Claude.ai-subscription-first login flows.

## Quality gates

- Typecheck: `bun run typecheck`
- Tests: `bun test`
- Combined check: `bun run check`
- Enable local git hook: `bun run setup:hooks`

## Automated release

GitHub Actions runs on every push to `main` and once per day:

1. Fetches the latest `install.sh` from `https://claude.ai/install.sh`.
2. Extracts `GCS_BUCKET` from that script and reads the latest Claude Code version.
3. On `push` to `main`, always creates a rolling release tag `claude-vX.Y.Z-build.<run_number>`.
4. On scheduled/manual runs, creates `claude-vX.Y.Z` only when that upstream version is not released yet.
5. Builds `claudex` binaries for Linux, macOS, and Windows via Bun `--compile`.
6. Publishes a GitHub release with those binaries.
