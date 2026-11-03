// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TranslationSettingsPage } from "../src/client/pages/TranslationSettingsPage";

function json(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }));
}

describe("translation settings", () => {
  let state: any;
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url !== "/api/settings/translation" && url !== "/api/settings/translation/test") throw new Error(`Unexpected request: ${url}`);
    if (url === "/api/settings/translation" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      state = { ...state, protocol: body.protocol, baseUrl: body.baseUrl, model: body.model, targetLanguage: body.targetLanguage, hasApiKey: Boolean(body.apiKey) || state.hasApiKey, configured: Boolean(body.protocol && body.baseUrl && (body.apiKey || state.hasApiKey) && body.model), tested: false, enabled: false };
      return json(state);
    }
    if (url === "/api/settings/translation/test") {
      state = { ...state, tested: true, connectionTestedAt: "2026-11-03 12:00:00" };
      return json(state);
    }
    return json(state);
  });

  beforeEach(() => {
    state = { protocol: null, baseUrl: "", hasApiKey: false, model: "", targetLanguage: "zh-CN", enabled: false, configured: false, tested: false, connectionTestedAt: null, cacheEntries: 0 };
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("starts with blank public provider values and requires an explicit protocol", async () => {
    render(<TranslationSettingsPage />);
    expect((await screen.findByLabelText("API 协议") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("API Base URL") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("模型名称") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("尚未保存 API Key。")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "启用邮件翻译" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("saves a secret without redisplaying it and enables only after testing", async () => {
    const user = userEvent.setup();
    render(<TranslationSettingsPage />);
    await screen.findByLabelText("API 协议");
    await user.selectOptions(screen.getByLabelText("API 协议"), "responses");
    await user.type(screen.getByLabelText("API Base URL"), "https://api.example.test/v1");
    await user.type(screen.getByLabelText("模型名称"), "example-model");
    await user.type(screen.getByLabelText("API Key"), "browser-only-test-key");
    await user.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(screen.getByText(/服务器已加密保存 API Key/)).toBeTruthy());
    expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(screen.getByText("连接成功。现在可以启用邮件翻译。")).toBeTruthy());
    expect((screen.getByRole("checkbox", { name: "启用邮件翻译" }) as HTMLInputElement).disabled).toBe(false);
    expect(JSON.stringify(state)).not.toContain("browser-only-test-key");
  });
});
