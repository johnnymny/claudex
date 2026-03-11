#!/usr/bin/env bun

import net from "node:net";
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { hasEffortFlag, parseClaudexArgs } from "./cli-args.ts";
import { startProxy } from "./proxy.ts";
import { loadRuntimeConfig } from "./runtime-config.ts";
import type { AuthState } from "./upstream.ts";

const rawArgs = process.argv.slice(2);
const parsedArgs = parseClaudexArgs(rawArgs);
const args = parsedArgs.claudeArgs;
const hasSettingsArg = parsedArgs.hasSettingsArg;
const safeMode = parsedArgs.safeMode;
const preserveClientEffort = hasEffortFlag(args);
const defaultReasoningEffort = process.env.CLAUDEX_DEFAULT_REASONING_EFFORT || "xhigh";
const debug = process.env.CLAUDEX_DEBUG === "1";
const claudeSubcommands = new Set([
  "agents",
  "auth",
  "doctor",
  "install",
  "mcp",
  "open",
  "plugin",
  "server",
  "setup-token",
  "update",
  "upgrade",
  "remote-control",
  "rc",
]);

function fail(message: string): never {
  console.error(`claudex: ${message}`);
  process.exit(1);
}

function ensureExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function resolveSelfDir(): string {
  const arg1 = process.argv[1];
  if (typeof arg1 === "string" && arg1.length > 0 && !arg1.startsWith("-")) {
    const resolvedArg1 = safeRealpath(arg1);
    if (resolvedArg1) {
      return dirname(resolvedArg1);
    }
  }

  const resolvedExecPath = safeRealpath(process.execPath);
  if (resolvedExecPath) {
    return dirname(resolvedExecPath);
  }

  return process.cwd();
}

function resolveClaudeBinary(): string {
  if (process.env.CLAUDEX_CLAUDE_BIN) {
    return process.env.CLAUDEX_CLAUDE_BIN;
  }

  const scriptDir = resolveSelfDir();
  const reverseDir = join(scriptDir, "reverse");

  if (existsSync(reverseDir)) {
    const localCandidates = readdirSync(reverseDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith("claude-"))
      .map((entry) => join(reverseDir, entry.name))
      .filter((path) => ensureExecutable(path))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));

    if (localCandidates.length > 0) {
      return localCandidates[0];
    }
  }

  const binaryInPath = Bun.which("claude");
  if (binaryInPath) {
    return binaryInPath;
  }

  fail("Claude binary not found. Set CLAUDEX_CLAUDE_BIN.");
}

function pickFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("failed to get listen port"));
        return;
      }

      const port = addr.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

function buildWorkspaceSummary(rootDir: string): string | undefined {
  try {
    const ignored = new Set([".git", "node_modules", "dist", ".DS_Store", ".idea", ".vscode"]);
    const topEntries = readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => !ignored.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const dirs = topEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const files = topEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const lines = [
      `cwd: ${rootDir}`,
      `top-level dirs: ${dirs.slice(0, 20).join(", ") || "(none)"}`,
      `top-level files: ${files.slice(0, 30).join(", ") || "(none)"}`,
    ];

    for (const dirName of ["src", "tests", "scripts"]) {
      const dirPath = join(rootDir, dirName);
      if (!existsSync(dirPath)) {
        continue;
      }
      try {
        const children = readdirSync(dirPath, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        lines.push(`${dirName}/ files: ${children.slice(0, 30).join(", ") || "(none)"}`);
      } catch {
        /* skip */
      }
    }

    const readmePath = join(rootDir, "README.md");
    if (existsSync(readmePath)) {
      try {
        const preview = readFileSync(readmePath, "utf8").split("\n").slice(0, 24).join("\n");
        if (preview.trim()) {
          lines.push("README.md preview:", preview);
        }
      } catch {
        /* skip */
      }
    }

    return lines.join("\n");
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const runtime = loadRuntimeConfig({
    forcedModelOverride: parsedArgs.modelOverride,
  });
  const upstreamOrigin = new URL(runtime.upstreamBaseUrl);
  const claudeBinary = resolveClaudeBinary();

  const listenHost = process.env.CLAUDEX_LISTEN_HOST || "127.0.0.1";
  const listenPort = process.env.CLAUDEX_PORT ? Number(process.env.CLAUDEX_PORT) : await pickFreePort(listenHost);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    fail("invalid CLAUDEX_PORT value");
  }

  const authState: AuthState = {
    bearerToken: runtime.upstreamBearerToken,
    extraHeaders: runtime.upstreamExtraHeaders,
    chatgptRefreshConfig: runtime.chatgptRefreshConfig,
  };
  const workspaceSummary = buildWorkspaceSummary(process.cwd());

  const proxyServer = await startProxy(listenHost, listenPort, upstreamOrigin, authState, {
    forcedModel: runtime.forcedModel,
    defaultReasoningEffort,
    preserveClientEffort,
    debug,
    safeMode,
    workspaceSummary,
    upstreamWireApi: runtime.upstreamWireApi,
    listenPort,
  });

  const proxyUrl = `http://${listenHost}:${listenPort}`;
  const refreshStatus = runtime.chatgptRefreshConfig ? "on" : "off";
  console.error(
    `claudex: proxy=${proxyUrl} force_model=${runtime.forcedModel} wire_api=${runtime.upstreamWireApi} safe_mode=${safeMode} auth_mode=${runtime.authMode} auto_refresh=${refreshStatus}`
  );

  const injectedArgs = [...args];
  const forcedLoginMethod = (process.env.CLAUDEX_FORCE_LOGIN_METHOD || "console").trim();
  const isSubcommandInvocation =
    injectedArgs.length > 0 && !injectedArgs[0].startsWith("-") && claudeSubcommands.has(injectedArgs[0]);
  if (!isSubcommandInvocation && !hasSettingsArg && forcedLoginMethod.length > 0 && forcedLoginMethod !== "none") {
    injectedArgs.push("--settings", JSON.stringify({ forceLoginMethod: forcedLoginMethod }));
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: proxyUrl,
    ANTHROPIC_API_KEY: runtime.upstreamBearerToken,
    ANTHROPIC_MODEL: runtime.forcedModel,
    ANTHROPIC_SMALL_FAST_MODEL: runtime.forcedModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: runtime.forcedModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: runtime.forcedModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: runtime.forcedModel,
    CLAUDE_CODE_SUBAGENT_MODEL: runtime.forcedModel,
  };
  if (safeMode) {
    childEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  } else {
    delete childEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  }

  const child = spawn(claudeBinary, injectedArgs, {
    stdio: "inherit",
    env: childEnv,
  });

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (child.exitCode === null && !child.killed) {
      child.kill(signal);
    }
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(128);
        return;
      }
      resolve(code ?? 0);
    });
  });

  await new Promise<void>((resolve) => {
    proxyServer.close(() => resolve());
  });

  process.exit(exitCode);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`claudex: ${message}`);
  process.exit(1);
});
