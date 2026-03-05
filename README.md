# claudex

`claudex` is a Bun-based launcher that runs Claude Code against an OpenAI-compatible endpoint.

You can get binary from [Releases](https://github.com/EdamAme-x/claudex/releases)

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

Optional environment variables:

- `CLAUDEX_FORCE_MODEL` (default: value from `~/.codex/config.toml` `model`, fallback `gpt-5.3-codex`)
- `CLAUDEX_DEFAULT_REASONING_EFFORT` (default: `xhigh`)
- `CLAUDEX_CLAUDE_BIN`
- `CLAUDEX_CODEX_CONFIG` (override `~/.codex/config.toml`)
- `CLAUDEX_CODEX_AUTH` (override `~/.codex/auth.json`)
- `CLAUDEX_MODEL_PROVIDER` (override `model_provider` selection)
- `CLAUDEX_UPSTREAM_BASE_URL` (force endpoint URL)
- `CLAUDEX_UPSTREAM_API_KEY` (force API key)
- `CLAUDEX_PORT`
- `CLAUDEX_DEBUG=1`

## Quality gates

- Typecheck: `bun run typecheck`
- Tests: `bun test`
- Combined check: `bun run check`
- Enable local git hook: `bun run setup:hooks`

## Automated release

GitHub Actions runs on every push to `main` and once per day:

1. Fetches the latest `install.sh` from `https://claude.ai/install.sh`.
2. Extracts `GCS_BUCKET` from that script and reads the latest Claude Code version.
3. Skips if this repo already has a release tag for that version.
4. Builds `claudex` binaries for Linux, macOS, and Windows via Bun `--compile`.
5. Publishes a GitHub release with those binaries.
