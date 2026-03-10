# claudex

`claudex` is a Bun-based launcher that runs Claude Code against an OpenAI-compatible endpoint.

## Fork-specific changes

This fork currently adds:
- Responses-only sanitization of unsupported Anthropic top-level request fields such as `temperature`
- Preservation of those fields on `messages` upstreams
- A Windows-local ChatGPT-token launcher workflow (`launch-claudex.py`, `start-claudex.bat`)
- Restore-safe wrapper behavior for temporary `auth.json` / `config.toml` mutations
- Release binaries published from this fork's GitHub Releases

You can download binaries from this repository's [Releases](../../releases).

## Local usage

0. Install dependencies:

```bash
bun install
```

1. Ensure Codex auth file exists (config is optional but recommended):

```text
~/.codex/auth.json
~/.codex/config.toml
```

2. Run:

```bash
./claudex
```

Windows-local launcher wrapper for one specific ChatGPT-token workflow:

```bash
python launch-claudex.py
```

This wrapper is not a general cross-machine entrypoint. It assumes:
- a repo-local `claudex-windows-x64.exe`
- `~/.codex/auth.json`
- `~/.codex/config.toml`
- a machine-specific `WORK_DIR` inside the script
- temporary mutation of `auth.json` / `config.toml` for ChatGPT-token routing, with restoration on exit

Repository-local batch launchers are also included for the same local workflow:

```text
start-claudex.bat
start.bat
```

If you want a portable setup, use `./claudex` or a compiled release binary instead.

Wrapper flags:

- `--model <id>` / `--upstream-model <id>`: override the upstream OpenAI model for this run only. `claudex` consumes this flag itself and does not forward it to the Claude binary.
- `--no-safe`: disables `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` for that run.
- By default, `claudex` enables safe mode (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`).

Example:

```bash
./claudex --model gpt-5.5-chat
```

Optional environment variables:

- `CLAUDEX_FORCE_MODEL` (used when no CLI `--model` / `--upstream-model` is given; otherwise CLI wins. Default: value of `model` from `~/.codex/config.toml`; fallback: `gpt-5.3-codex`)
- `CLAUDEX_DEFAULT_REASONING_EFFORT` (default: `xhigh`)
- `CLAUDEX_CLAUDE_BIN`
- `CLAUDEX_CODEX_CONFIG` (overrides `~/.codex/config.toml`)
- `CLAUDEX_CODEX_AUTH` (overrides `~/.codex/auth.json`)
- `CLAUDEX_MODEL_PROVIDER` (overrides `model_provider` selection)
- `CLAUDEX_UPSTREAM_BASE_URL` (force endpoint URL)
- `CLAUDEX_UPSTREAM_WIRE_API` (`messages` or `responses`; overrides provider `wire_api`)
- `CLAUDEX_UPSTREAM_API_KEY` (force API key)
- `CLAUDEX_UPSTREAM_BEARER_TOKEN` (force bearer token for ChatGPT token mode)
- `CLAUDEX_CHATGPT_BEARER_TOKEN` (alias of `CLAUDEX_UPSTREAM_BEARER_TOKEN`)
- `CLAUDEX_CHATGPT_ACCOUNT_ID` (override `ChatGPT-Account-Id` header)
- `CLAUDEX_CHATGPT_BASE_URL` (default: `https://chatgpt.com/backend-api/codex`)
- `CLAUDEX_CHATGPT_DEFAULT_MODEL` (default: `gpt-5-codex` when ChatGPT mode is active and no model is explicitly configured)
- `CLAUDEX_FORCE_LOGIN_METHOD` (default: `console`; set to `none` to disable injection)
- `CLAUDEX_PORT`
- `CLAUDEX_DEBUG=1`

Authentication note:

- Priority is:
  1. Use `model_provider` / `CLAUDEX_UPSTREAM_BASE_URL` when resolvable, authenticated via API key.
  2. If no provider is resolvable, fall back to official ChatGPT endpoint (`https://chatgpt.com/backend-api/codex`) and use `tokens.access_token` (then `tokens.id_token`) from `~/.codex/auth.json`.
- When the upstream uses `wire_api = "responses"` (or ChatGPT fallback mode), `claudex` translates Anthropic `POST /v1/messages` requests, tools, and tool results to the OpenAI Responses API and maps streamed tool calls back into Anthropic `tool_use` blocks.
- On `responses` upstreams, `claudex` strips unsupported Anthropic top-level request fields such as `temperature` before forwarding. On `messages` upstreams, those fields are preserved.
- In token mode, `claudex` automatically refreshes expired tokens via `tokens.refresh_token` when possible.
- In token mode, if `tokens.account_id` exists, `claudex` sends it as `ChatGPT-Account-Id`.
- To avoid model-availability errors on ChatGPT accounts, `claudex` uses `gpt-5-codex` as the implicit default model in ChatGPT mode (unless you explicitly set `model` or `CLAUDEX_FORCE_MODEL`).
- `claudex` sets `ANTHROPIC_API_KEY` to the upstream bearer credential and, unless you pass `--settings` yourself, injects `--settings {"forceLoginMethod":"console"}` to avoid Claude.ai-subscription-first login flows.

## Quality gates

- Typecheck: `bun run typecheck`
- Tests: `bun test`
- `bun test` includes an integration test that round-trips Anthropic `tool_use` / `tool_result` through a Responses upstream mock (`tests/proxy.integration.test.ts`).
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
