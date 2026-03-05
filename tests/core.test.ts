import { describe, expect, test } from "bun:test";
import {
  applyDefaultEffort,
  approxTokenCount,
  hasEffortFlag,
  parseApiKeyFromAuthJson,
  parseCodexConfig,
  resolveUpstreamFromCodexConfig,
  sanitizeToolFields,
} from "../src/core";

describe("hasEffortFlag", () => {
  test("detects --effort and --effort=", () => {
    expect(hasEffortFlag(["--foo", "--effort"])).toBe(true);
    expect(hasEffortFlag(["--effort=xhigh"])).toBe(true);
    expect(hasEffortFlag(["--model", "x"])).toBe(false);
  });
});

describe("parseCodexConfig", () => {
  const configToml = `
model_provider = "unlimitex"
model = "gpt-5.3-codex"

[model_providers.voids]
name = "voids"
base_url = "https://voids.example/v1"
wire_api = "responses"

[model_providers.unlimitex]
name = "unlimitex"
base_url = "https://unlimitex.example/v1"
wire_api = "responses"
`;

  test("parses model and providers", () => {
    const parsed = parseCodexConfig(configToml);
    expect(parsed.modelProvider).toBe("unlimitex");
    expect(parsed.model).toBe("gpt-5.3-codex");
    expect(parsed.providers.unlimitex.baseUrl).toBe("https://unlimitex.example/v1");
  });

  test("resolves selected provider base url", () => {
    const resolved = resolveUpstreamFromCodexConfig(configToml);
    expect(resolved.baseUrl).toBe("https://unlimitex.example/v1");
    expect(resolved.model).toBe("gpt-5.3-codex");
  });

  test("base url override wins", () => {
    const resolved = resolveUpstreamFromCodexConfig(configToml, {
      baseUrlOverride: "https://override.example/v1",
    });
    expect(resolved.baseUrl).toBe("https://override.example/v1");
  });
});

describe("parseApiKeyFromAuthJson", () => {
  test("reads OPENAI_API_KEY", () => {
    const authJson = JSON.stringify({ OPENAI_API_KEY: "sk-test" });
    expect(parseApiKeyFromAuthJson(authJson)).toBe("sk-test");
  });

  test("env override wins", () => {
    const authJson = JSON.stringify({ OPENAI_API_KEY: "sk-file" });
    expect(parseApiKeyFromAuthJson(authJson, "sk-env")).toBe("sk-env");
  });

  test("throws without key", () => {
    const authJson = JSON.stringify({ tokens: { access_token: "x" } });
    expect(() => parseApiKeyFromAuthJson(authJson)).toThrow("failed to read OPENAI API key");
  });
});

describe("approxTokenCount", () => {
  test("counts text parts", () => {
    const count = approxTokenCount({
      messages: [{ content: "abcd" }, { content: [{ text: "1234" }, { content: "abcd" }] }],
    });
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("returns at least one", () => {
    expect(approxTokenCount({})).toBe(1);
  });
});

describe("applyDefaultEffort", () => {
  test("sets xhigh for gpt-5.3-codex by default", () => {
    const body: Record<string, any> = {};
    applyDefaultEffort(body, {
      forcedModel: "gpt-5.3-codex",
      defaultReasoningEffort: "xhigh",
      preserveClientEffort: false,
    });
    expect(body.output_config.effort).toBe("xhigh");
    expect(body.reasoning.effort).toBe("xhigh");
  });

  test("does not overwrite when preserving client effort", () => {
    const body: Record<string, any> = {};
    applyDefaultEffort(body, {
      forcedModel: "gpt-5.3-codex",
      defaultReasoningEffort: "xhigh",
      preserveClientEffort: true,
    });
    expect(body.output_config).toBeUndefined();
  });
});

describe("sanitizeToolFields", () => {
  test("removes defer_loading from each tool", () => {
    const body: Record<string, any> = {
      tools: [{ name: "a", defer_loading: true }, { name: "b" }],
    };
    const removed = sanitizeToolFields(body);
    expect(removed).toBe(1);
    expect(body.tools[0].defer_loading).toBeUndefined();
  });
});
