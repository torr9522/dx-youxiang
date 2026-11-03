import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createPublicLookup, isPublicImageAddress } from "./remote-images.js";

export type TranslationProtocol = "responses" | "chat_completions";

export type ProviderConfig = {
  protocol: TranslationProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export interface TranslationProvider {
  complete(config: ProviderConfig, instructions: string, input: string, maxOutputTokens: number): Promise<string>;
}

const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 30_000;

export function providerEndpoint(baseUrl: string, protocol: TranslationProtocol, nodeEnv = "production") {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error("API 地址不能包含凭据、查询参数或片段");
  const localDevelopment = nodeEnv === "development" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) throw new Error("API 地址必须使用 HTTPS");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if ((!localDevelopment && port !== 443) || (localDevelopment && port < 1)) throw new Error("API 地址端口不受支持");
  const suffix = protocol === "responses" ? "responses" : "chat/completions";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${suffix}`;
  return { url, localDevelopment };
}

function extractResponsesText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text) return payload.output_text;
  const values = (payload?.output ?? []).flatMap((item: any) => item?.type === "message" ? item.content ?? [] : [])
    .filter((item: any) => item?.type === "output_text" && typeof item.text === "string")
    .map((item: any) => item.text);
  if (!values.length) throw new Error("Responses API 未返回文本结果");
  return values.join("");
}

function extractChatText(payload: any) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content) return content;
  if (Array.isArray(content)) {
    const text = content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("");
    if (text) return text;
  }
  throw new Error("Chat Completions API 未返回文本结果");
}

async function postJson(url: URL, body: object, apiKey: string, localDevelopment: boolean) {
  const literalAddress = url.hostname.replace(/^\[|\]$/g, "");
  if (!localDevelopment && isIP(literalAddress) && !isPublicImageAddress(literalAddress)) throw new Error("API 地址不是公网地址");
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise<any>((resolve, reject) => {
    let settled = false;
    const finish = <T>(handler: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      handler(value);
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "POST",
      lookup: localDevelopment ? undefined : createPublicLookup(),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "content-length": String(payload.length),
        "user-agent": "Dx-Youxiang-Translation/1",
      },
    }, (response) => {
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
        response.resume();
        finish(reject, new Error("翻译 API 不允许重定向"));
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > MAX_PROVIDER_RESPONSE_BYTES) response.destroy(new Error("翻译 API 响应过大"));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        let parsed: any;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { finish(reject, new Error("翻译 API 返回了无效 JSON")); return; }
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          finish(reject, new Error(`翻译 API 请求失败 (HTTP ${response.statusCode})`));
          return;
        }
        finish(resolve, parsed);
      });
      response.on("error", (error) => finish(reject, error));
    });
    const deadline = setTimeout(() => {
      const error = new Error("翻译 API 请求超时");
      request.destroy(error);
      finish(reject, error);
    }, PROVIDER_TIMEOUT_MS);
    request.setTimeout(PROVIDER_TIMEOUT_MS, () => request.destroy(new Error("翻译 API 请求超时")));
    request.on("error", (error) => finish(reject, error));
    request.end(payload);
  });
}

export class OpenAiCompatibleProvider implements TranslationProvider {
  constructor(private nodeEnv = "production") {}

  async complete(config: ProviderConfig, instructions: string, input: string, maxOutputTokens: number) {
    const { url, localDevelopment } = providerEndpoint(config.baseUrl, config.protocol, this.nodeEnv);
    if (config.protocol === "responses") {
      const payload = await postJson(url, {
        model: config.model,
        instructions,
        input,
        max_output_tokens: maxOutputTokens,
        store: false,
        tools: [],
      }, config.apiKey, localDevelopment);
      return extractResponsesText(payload);
    }
    const payload = await postJson(url, {
      model: config.model,
      messages: [
        { role: "developer", content: instructions },
        { role: "user", content: input },
      ],
      max_completion_tokens: maxOutputTokens,
      stream: false,
      store: false,
      tools: [],
    }, config.apiKey, localDevelopment);
    return extractChatText(payload);
  }
}
