# claudex

日本語版READMEです。English version: [README.en.md](./README.en.md)

`claudex` は、Claude Code を OpenAI 互換 endpoint / ChatGPT Codex backend に接続するための Bun ベース launcher です。

## この fork で追加したこと

この fork では主に次を追加しています。

- `responses` upstream 向けに、`temperature` など未対応の Anthropic top-level request field を sanitize
- `messages` upstream ではそれらの field を保持
- Windows ローカル運用向け ChatGPT-token launcher (`launch-claudex.py`, `start-claudex.bat`) を同梱
- wrapper が `auth.json` / `config.toml` を一時変更しても終了時に復元するよう安全化
- GitHub Releases をこの fork 側から発行

バイナリはこの repo の [Releases](../../releases) から取得できます。

## ローカル使用方法

### 0. 依存関係

```bash
bun install
```

### 1. Codex 認証ファイルを用意

config は必須ではありませんが、通常は次を想定します。

```text
~/.codex/auth.json
~/.codex/config.toml
```

### 2. 通常起動

```bash
./claudex
```

## Windows ローカル wrapper

特定の ChatGPT-token 運用向けに、Windows ローカル wrapper を同梱しています。

```bash
python launch-claudex.py
```

この wrapper は汎用・移植可能な entrypoint ではありません。前提は次の通りです。

- repo ローカルに `claudex-windows-x64.exe` があること
- `~/.codex/auth.json` があること
- `~/.codex/config.toml` があること
- script 内の `WORK_DIR` がそのマシンに合っていること
- ChatGPT-token routing のために `auth.json` / `config.toml` を一時変更し、終了時に復元すること

同じローカル運用向けに、batch launcher も含めています。

```text
start-claudex.bat
start.bat
```

移植性を優先する場合は、`./claudex` か release binary を使ってください。

## Wrapper flags

- `--model <id>` / `--upstream-model <id>`: その実行だけ upstream OpenAI model を上書き。`claudex` 自身が消費し、Claude binary には渡しません
- `--no-safe`: その実行だけ `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` を無効化
- デフォルトでは safe mode (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`) を有効化

例:

```bash
./claudex --model gpt-5.5-chat
```

## 環境変数

- `CLAUDEX_FORCE_MODEL`
  - CLI の `--model` / `--upstream-model` が無い時だけ使用
  - 既定: `~/.codex/config.toml` の `model`
  - fallback: `gpt-5.3-codex`
- `CLAUDEX_DEFAULT_REASONING_EFFORT` (default: `xhigh`)
- `CLAUDEX_CLAUDE_BIN`
- `CLAUDEX_CODEX_CONFIG` (`~/.codex/config.toml` override)
- `CLAUDEX_CODEX_AUTH` (`~/.codex/auth.json` override)
- `CLAUDEX_MODEL_PROVIDER` (`model_provider` selection override)
- `CLAUDEX_UPSTREAM_BASE_URL` (endpoint URL 強制指定)
- `CLAUDEX_UPSTREAM_WIRE_API` (`messages` or `responses`; provider `wire_api` override)
- `CLAUDEX_UPSTREAM_API_KEY`
- `CLAUDEX_UPSTREAM_BEARER_TOKEN`
- `CLAUDEX_CHATGPT_BEARER_TOKEN` (`CLAUDEX_UPSTREAM_BEARER_TOKEN` の alias)
- `CLAUDEX_CHATGPT_ACCOUNT_ID` (`ChatGPT-Account-Id` header override)
- `CLAUDEX_CHATGPT_BASE_URL` (default: `https://chatgpt.com/backend-api/codex`)
- `CLAUDEX_CHATGPT_DEFAULT_MODEL` (ChatGPT mode で model 未指定時の default: `gpt-5-codex`)
- `CLAUDEX_FORCE_LOGIN_METHOD` (default: `console`; `none` で injection 無効)
- `CLAUDEX_PORT`
- `CLAUDEX_DEBUG=1`

## 認証と upstream 動作

優先順位は次の通りです。

1. `model_provider` / `CLAUDEX_UPSTREAM_BASE_URL` が解決できる場合は API key 認証で使う
2. 解決できない場合は ChatGPT endpoint (`https://chatgpt.com/backend-api/codex`) に fallback し、`~/.codex/auth.json` の `tokens.access_token`（次点で `tokens.id_token`）を使う

補足:

- upstream が `wire_api = "responses"`（または ChatGPT fallback mode）の時、`claudex` は Anthropic `POST /v1/messages` を OpenAI Responses API へ変換し、streamed tool call を Anthropic `tool_use` block に戻します
- `responses` upstream では、`temperature` など未対応の Anthropic top-level request field を forwarding 前に除去します
- `messages` upstream では、それらの field は保持します
- token mode では、可能なら `tokens.refresh_token` を使って token を自動 refresh します
- token mode で `tokens.account_id` があれば `ChatGPT-Account-Id` header として送ります
- ChatGPT account 上の model availability error を避けるため、ChatGPT mode で model 未指定時の暗黙 default は `gpt-5-codex` です
- `claudex` は upstream bearer credential を `ANTHROPIC_API_KEY` に設定し、`--settings` 未指定時は `--settings {"forceLoginMethod":"console"}` を注入して Claude.ai subscription 優先 login flow を避けます

## Quality gates

- Typecheck: `bun run typecheck`
- Tests: `bun test`
- `bun test` には、Anthropic `tool_use` / `tool_result` を Responses upstream mock 経由で round-trip する integration test (`tests/proxy.integration.test.ts`) を含みます
- Combined check: `bun run check`
- Local git hook: `bun run setup:hooks`

## Automated release

GitHub Actions は `main` への push と日次 schedule で動きます。

1. `https://claude.ai/install.sh` から最新 installer を取得
2. script から `GCS_BUCKET` を抽出し、最新 Claude Code version を読む
3. `main` への push では、毎回 `claude-vX.Y.Z-build.<run_number>` の rolling build release を作成
4. scheduled / manual run では、未 release の upstream version の時だけ `claude-vX.Y.Z` を作成
5. Bun `--compile` で Linux / macOS / Windows binary を build
6. GitHub release として publish
