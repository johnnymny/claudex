export type JsonObject = Record<string, any>;

export function hasEffortFlag(args: string[]): boolean {
  return args.some((arg) => arg === "--effort" || arg.startsWith("--effort="));
}

export function parseClaudexArgs(rawArgs: string[]): {
  claudeArgs: string[];
  safeMode: boolean;
  hasSettingsArg: boolean;
} {
  let safeMode = true;
  let hasSettingsArg = false;
  const claudeArgs: string[] = [];

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];

    if (arg === "--no-safe") {
      safeMode = false;
      continue;
    }
    if (arg === "--settings" || arg.startsWith("--settings=")) {
      hasSettingsArg = true;
    }
    claudeArgs.push(arg);
  }

  return { claudeArgs, safeMode, hasSettingsArg };
}

export interface ParsedCodexConfig {
  model?: string;
  modelProvider?: string;
  providers: Record<
    string,
    {
      key: string;
      name?: string;
      baseUrl?: string;
      wireApi?: string;
    }
  >;
}

function parseTopLevelString(contents: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = contents.match(new RegExp(`^\\s*${escaped}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1]?.trim();
}

export function parseCodexConfig(contents: string): ParsedCodexConfig {
  const providers: ParsedCodexConfig["providers"] = {};
  const headerRegex = /^\[model_providers\.([^\]]+)\]\s*$/gm;

  const headers = Array.from(contents.matchAll(headerRegex));
  for (let i = 0; i < headers.length; i += 1) {
    const current = headers[i];
    const next = headers[i + 1];

    const providerKey = current[1]?.trim();
    if (!providerKey) {
      continue;
    }

    const blockStart = (current.index ?? 0) + current[0].length;
    const blockEnd = next?.index ?? contents.length;
    const block = contents.slice(blockStart, blockEnd);

    providers[providerKey] = {
      key: providerKey,
      name: parseTopLevelString(block, "name"),
      baseUrl: parseTopLevelString(block, "base_url"),
      wireApi: parseTopLevelString(block, "wire_api"),
    };
  }

  return {
    model: parseTopLevelString(contents, "model"),
    modelProvider: parseTopLevelString(contents, "model_provider"),
    providers,
  };
}

export function resolveUpstreamFromCodexConfig(
  contents: string,
  options: {
    providerOverride?: string;
    baseUrlOverride?: string;
  } = {}
): { baseUrl: string; providerKey?: string; model?: string } {
  const parsed = parseCodexConfig(contents);

  if (options.baseUrlOverride && options.baseUrlOverride.trim()) {
    return {
      baseUrl: options.baseUrlOverride.trim(),
      providerKey: options.providerOverride || parsed.modelProvider,
      model: parsed.model,
    };
  }

  const preferredProvider = options.providerOverride || parsed.modelProvider;
  if (preferredProvider) {
    const chosen = parsed.providers[preferredProvider];
    if (chosen?.baseUrl?.trim()) {
      return {
        baseUrl: chosen.baseUrl.trim(),
        providerKey: preferredProvider,
        model: parsed.model,
      };
    }
  }

  for (const provider of Object.values(parsed.providers)) {
    if (provider.baseUrl?.trim()) {
      return {
        baseUrl: provider.baseUrl.trim(),
        providerKey: provider.key,
        model: parsed.model,
      };
    }
  }

  throw new Error("failed to resolve base_url from ~/.codex/config.toml");
}

export function parseApiKeyFromAuthJson(contents: string, envApiKey?: string): string {
  if (envApiKey?.trim()) {
    return envApiKey.trim();
  }

  let parsed: any;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("failed to parse ~/.codex/auth.json as JSON");
  }

  const candidates = [
    parsed?.OPENAI_API_KEY,
    parsed?.openai_api_key,
    parsed?.api_key,
    parsed?.openai?.api_key,
    parsed?.providers?.openai?.api_key,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  throw new Error("failed to read OPENAI API key from ~/.codex/auth.json");
}

export function approxTokenCount(body: JsonObject): number {
  const lines: string[] = [];
  if (Array.isArray(body?.messages)) {
    for (const message of body.messages) {
      if (typeof message?.content === "string") {
        lines.push(message.content);
        continue;
      }
      if (Array.isArray(message?.content)) {
        for (const part of message.content) {
          if (typeof part?.text === "string") {
            lines.push(part.text);
          }
          if (typeof part?.content === "string") {
            lines.push(part.content);
          }
        }
      }
    }
  }

  const text = lines.join("\n");
  return Math.max(1, Math.ceil(text.length / 4));
}

export function hasExplicitEffort(body: JsonObject): boolean {
  return Boolean(
    (typeof body?.effort === "string" && body.effort.length > 0) ||
      (typeof body?.output_config?.effort === "string" && body.output_config.effort.length > 0) ||
      (typeof body?.reasoning?.effort === "string" && body.reasoning.effort.length > 0)
  );
}

export function applyDefaultEffort(
  body: JsonObject,
  options: {
    forcedModel: string;
    defaultReasoningEffort: string;
    preserveClientEffort: boolean;
  }
): void {
  if (options.forcedModel !== "gpt-5.3-codex") {
    return;
  }
  if (options.preserveClientEffort || hasExplicitEffort(body)) {
    return;
  }

  if (typeof body.output_config !== "object" || body.output_config === null) {
    body.output_config = {};
  }
  body.output_config.effort = options.defaultReasoningEffort;

  if (typeof body.reasoning !== "object" || body.reasoning === null) {
    body.reasoning = {};
  }
  body.reasoning.effort = options.defaultReasoningEffort;
}

export function sanitizeToolFields(body: JsonObject): number {
  let removed = 0;
  if (!Array.isArray(body?.tools)) {
    return removed;
  }

  for (const tool of body.tools) {
    if (!tool || typeof tool !== "object") {
      continue;
    }
    if ("defer_loading" in tool) {
      delete tool.defer_loading;
      removed += 1;
    }
  }

  return removed;
}
