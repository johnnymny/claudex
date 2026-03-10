import http from "node:http";
import { describe, expect, test } from "bun:test";
import { startProxy } from "../src/proxy.ts";
import type { AuthState } from "../src/upstream.ts";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function listen(server: http.Server, host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to read bound port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function writeResponsesSse(res: http.ServerResponse, response: Record<string, unknown>): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    connection: "keep-alive",
    "cache-control": "no-cache",
  });
  res.write(
    `event: response.created\ndata: ${JSON.stringify({
      type: "response.created",
      response: { id: "resp_test", model: response.model },
    })}\n\n`
  );
  res.write(
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response,
    })}\n\n`
  );
  res.end();
}

describe("proxy integration", () => {
  test("preserves temperature for messages upstreams", async () => {
    const upstreamRequests: Array<{ path: string; body: Record<string, any> }> = [];

    const upstreamServer = http.createServer(async (req, res) => {
      const bodyText = await readBody(req);
      const body = bodyText.length > 0 ? JSON.parse(bodyText) : {};
      upstreamRequests.push({
        path: req.url || "",
        body,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_test", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    });

    const upstreamPort = await listen(upstreamServer);
    const authState: AuthState = {
      bearerToken: "test-token",
      extraHeaders: {},
    };

    const proxyServer = await startProxy(
      "127.0.0.1",
      0,
      new URL(`http://127.0.0.1:${upstreamPort}/v1`),
      authState,
      {
        forcedModel: "gpt-5.4-mini",
        defaultReasoningEffort: "xhigh",
        preserveClientEffort: false,
        debug: false,
        safeMode: false,
        upstreamWireApi: "messages",
      }
    );

    const proxyAddress = proxyServer.address();
    if (!proxyAddress || typeof proxyAddress === "string") {
      await close(proxyServer);
      await close(upstreamServer);
      throw new Error("failed to read proxy port");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          stream: false,
          temperature: 0,
          messages: [{ role: "user", content: [{ type: "text", text: "Say OK" }] }],
        }),
      });

      expect(response.status).toBe(200);
      expect(upstreamRequests).toHaveLength(1);
      expect(upstreamRequests[0].path).toBe("/v1/messages");
      expect(upstreamRequests[0].body.temperature).toBe(0);
    } finally {
      await close(proxyServer);
      await close(upstreamServer);
    }
  });

  test("round-trips responses tool calls through anthropic messages", async () => {
    const upstreamRequests: Array<{ path: string; body: Record<string, any> }> = [];
    let requestCount = 0;

    const upstreamServer = http.createServer(async (req, res) => {
      const bodyText = await readBody(req);
      const body = bodyText.length > 0 ? JSON.parse(bodyText) : {};
      upstreamRequests.push({
        path: req.url || "",
        body,
      });
      requestCount += 1;

      if (requestCount === 1) {
        writeResponsesSse(res, {
          id: "resp_1",
          model: body.model,
          usage: { input_tokens: 17, output_tokens: 4 },
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Checking README" }],
            },
            {
              type: "function_call",
              call_id: "toolu_1",
              name: "read_file",
              arguments: JSON.stringify({ path: "README.md" }),
            },
          ],
        });
        return;
      }

      writeResponsesSse(res, {
        id: "resp_2",
        model: body.model,
        usage: { input_tokens: 23, output_tokens: 5 },
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "README title loaded" }],
          },
        ],
      });
    });

    const upstreamPort = await listen(upstreamServer);
    const authState: AuthState = {
      bearerToken: "test-token",
      extraHeaders: {},
    };

    const proxyServer = await startProxy(
      "127.0.0.1",
      0,
      new URL(`http://127.0.0.1:${upstreamPort}/v1`),
      authState,
      {
        forcedModel: "gpt-5.4-mini",
        defaultReasoningEffort: "xhigh",
        preserveClientEffort: false,
        debug: false,
        safeMode: false,
        upstreamWireApi: "responses",
      }
    );

    const proxyAddress = proxyServer.address();
    if (!proxyAddress || typeof proxyAddress === "string") {
      await close(proxyServer);
      await close(upstreamServer);
      throw new Error("failed to read proxy port");
    }

    try {
      const firstResponse = await fetch(`http://127.0.0.1:${proxyAddress.port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          stream: false,
          temperature: 0,
          messages: [{ role: "user", content: [{ type: "text", text: "Use read_file then summarize README.md" }] }],
          tools: [
            {
              name: "read_file",
              description: "Read a file",
              input_schema: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
              },
            },
          ],
        }),
      });

      expect(firstResponse.status).toBe(200);
      const firstBody = (await firstResponse.json()) as Record<string, any>;
      expect(firstBody.model).toBe("gpt-5.4-mini");
      expect(firstBody.stop_reason).toBe("tool_use");
      expect(firstBody.content).toEqual([
        { type: "text", text: "Checking README" },
        { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "README.md" } },
      ]);

      expect(upstreamRequests).toHaveLength(1);
      expect(upstreamRequests[0].path).toBe("/v1/responses");
      expect(upstreamRequests[0].body.model).toBe("gpt-5.4-mini");
      expect(upstreamRequests[0].body.stream).toBe(true);
      expect(upstreamRequests[0].body.temperature).toBeUndefined();
      expect(upstreamRequests[0].body.tools).toEqual([
        {
          type: "function",
          name: "read_file",
          description: "Read a file",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
      ]);

      const secondResponse = await fetch(`http://127.0.0.1:${proxyAddress.port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          stream: false,
          messages: [
            { role: "user", content: [{ type: "text", text: "Use read_file then summarize README.md" }] },
            {
              role: "assistant",
              content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "README.md" } }],
            },
            {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "# claudex" }],
            },
          ],
          tools: [
            {
              name: "read_file",
              description: "Read a file",
              input_schema: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
              },
            },
          ],
        }),
      });

      expect(secondResponse.status).toBe(200);
      const secondBody = (await secondResponse.json()) as Record<string, any>;
      expect(secondBody.model).toBe("gpt-5.4-mini");
      expect(secondBody.stop_reason).toBe("end_turn");
      expect(secondBody.content).toEqual([{ type: "text", text: "README title loaded" }]);

      expect(upstreamRequests).toHaveLength(2);
      expect(upstreamRequests[1].body.input).toEqual([
        {
          role: "user",
          content: [{ type: "input_text", text: "Use read_file then summarize README.md" }],
        },
        {
          type: "function_call",
          call_id: "toolu_1",
          name: "read_file",
          arguments: JSON.stringify({ path: "README.md" }),
        },
        {
          type: "function_call_output",
          call_id: "toolu_1",
          output: "# claudex",
        },
      ]);
    } finally {
      await close(proxyServer);
      await close(upstreamServer);
    }
  });
});
