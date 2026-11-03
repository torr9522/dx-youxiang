import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { OpenAiCompatibleProvider, providerEndpoint } from "../src/server/translation-provider.js";

const requests: Array<{ path: string; authorization?: string; body: any }> = [];
let baseUrl = "";
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  requests.push({ path: req.url ?? "", authorization: req.headers.authorization, body });
  res.setHeader("content-type", "application/json");
  if (req.url === "/v1/responses") return res.end(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "responses-result" }] }] }));
  if (req.url === "/v1/chat/completions") return res.end(JSON.stringify({ choices: [{ message: { content: "chat-result" }, finish_reason: "stop" }], usage: { total_tokens: 5 } }));
  if (req.url === "/redirect/responses") { res.statusCode = 302; res.setHeader("location", "/v1/responses"); return res.end("{}"); }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: { message: "not found" } }));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server failed");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

describe("OpenAI-compatible translation protocols", () => {
  it("uses the Responses endpoint and parses output_text items", async () => {
    const provider = new OpenAiCompatibleProvider("development");
    const result = await provider.complete({ protocol: "responses", baseUrl: `${baseUrl}/`, apiKey: "responses-key", model: "response-model" }, "instructions", "input", 123);
    expect(result).toBe("responses-result");
    expect(requests.at(-1)).toMatchObject({
      path: "/v1/responses",
      authorization: "Bearer responses-key",
      body: { model: "response-model", instructions: "instructions", input: "input", max_output_tokens: 123, store: false, tools: [] },
    });
  });

  it("uses the Chat Completions endpoint and parses choices independently", async () => {
    const provider = new OpenAiCompatibleProvider("development");
    const result = await provider.complete({ protocol: "chat_completions", baseUrl, apiKey: "chat-key", model: "chat-model" }, "developer instruction", "user input", 456);
    expect(result).toBe("chat-result");
    expect(requests.at(-1)).toMatchObject({
      path: "/v1/chat/completions",
      authorization: "Bearer chat-key",
      body: {
        model: "chat-model",
        messages: [{ role: "developer", content: "developer instruction" }, { role: "user", content: "user input" }],
        max_completion_tokens: 456,
        stream: false,
        store: false,
        tools: [],
      },
    });
  });

  it("allows HTTP only for explicit local development and rejects redirects", async () => {
    expect(() => providerEndpoint("http://api.example.test/v1", "responses", "production")).toThrow("HTTPS");
    const provider = new OpenAiCompatibleProvider("development");
    await expect(provider.complete({ protocol: "responses", baseUrl: baseUrl.replace("/v1", "/redirect"), apiKey: "key", model: "model" }, "instruction", "input", 32)).rejects.toThrow("不允许重定向");
  });

  it("blocks private production destinations before connecting", async () => {
    const provider = new OpenAiCompatibleProvider("production");
    await expect(provider.complete({ protocol: "responses", baseUrl: "https://127.0.0.1/v1", apiKey: "key", model: "model" }, "instruction", "input", 32)).rejects.toThrow("不是公网地址");
  });
});
