"""Launch claudex: chatgpt-token mode + config.toml model override.

Strategy: config.toml model triggers chatgpt-token auth routing,
CLAUDEX_FORCE_MODEL overrides the actual model sent to upstream API.
The original config.toml model is preserved and used as the upstream model.
"""
import json
import os
import re
import shutil
import subprocess
import sys

AUTH_PATH = os.path.expanduser("~/.codex/auth.json")
AUTH_BACKUP = os.path.expanduser("~/.codex/auth.json.bak")
CONFIG_PATH = os.path.expanduser("~/.codex/config.toml")
CONFIG_BACKUP = os.path.expanduser("~/.codex/config.toml.bak")
CLAUDEX_BIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "claudex-windows-x64.exe")
WORK_DIR = os.environ.get("CLAUDEX_WORK_DIR") or os.getcwd()

if not WORK_DIR:
    raise ValueError("Failed to resolve WORK_DIR. Set CLAUDEX_WORK_DIR explicitly.")
if not os.path.isdir(WORK_DIR):
    raise NotADirectoryError(f"Invalid work dir: {WORK_DIR}")

# Auth routing model (must be a -codex model to trigger chatgpt-token mode)
ROUTING_MODEL = "gpt-5.3-codex"

if not os.path.exists(AUTH_PATH):
    raise FileNotFoundError(f"Missing auth file: {AUTH_PATH}")
if not os.path.exists(CONFIG_PATH):
    raise FileNotFoundError(f"Missing config file: {CONFIG_PATH}")
if not os.path.exists(CLAUDEX_BIN):
    raise FileNotFoundError(f"Missing claudex binary: {CLAUDEX_BIN}")

shutil.copy2(AUTH_PATH, AUTH_BACKUP)
shutil.copy2(CONFIG_PATH, CONFIG_BACKUP)

# Ensure OPENAI_API_KEY is None (chatgpt-token mode requires this)
with open(AUTH_PATH) as f:
    auth = json.load(f)
if auth.get("OPENAI_API_KEY") is not None:
    auth["OPENAI_API_KEY"] = None
    with open(AUTH_PATH, "w") as f:
        json.dump(auth, f, indent=2)

# Read original config.toml and extract model name
with open(CONFIG_PATH) as f:
    config = f.read()

match = re.search(r'^model\s*=\s*"([^"]+)"', config, re.MULTILINE)
upstream_model = match.group(1) if match else "gpt-5.4"

# Patch config.toml for auth routing
config_patched = re.sub(
    r'^(model\s*=\s*)"[^"]+"',
    f'\\1"{ROUTING_MODEL}"',
    config,
    count=1,
    flags=re.MULTILINE,
)
with open(CONFIG_PATH, "w") as f:
    f.write(config_patched)

env = os.environ.copy()
env.update({
    # "CLAUDEX_DEBUG": "1",  # uncomment to debug
    "CLAUDEX_FORCE_MODEL": upstream_model,
    "CLAUDEX_DEFAULT_REASONING_EFFORT": "high",
})

os.chdir(WORK_DIR)
try:
    sys.exit(subprocess.call(
        [CLAUDEX_BIN, "--dangerously-skip-permissions"],
        env=env,
    ))
finally:
    shutil.copy2(AUTH_BACKUP, AUTH_PATH)
    shutil.copy2(CONFIG_BACKUP, CONFIG_PATH)
    if os.path.exists(AUTH_BACKUP):
        os.remove(AUTH_BACKUP)
    if os.path.exists(CONFIG_BACKUP):
        os.remove(CONFIG_BACKUP)
