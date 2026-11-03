// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/client/App";

function json(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }));
}

describe("mobile application navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/auth/session") return json({ csrfToken: "test-csrf" });
      if (url.startsWith("/api/mailboxes?stats=1&search=")) return json([]);
      if (url === "/api/domains") return json([]);
      if (url === "/api/audit") return json([]);
      throw new Error(`Unexpected request: ${url}`);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps every page available through a labelled compact menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    const menuButton = await screen.findByRole("button", { name: "打开导航菜单" });
    await user.click(menuButton);

    const nav = screen.getByRole("navigation", { name: "手机导航" });
    for (const label of ["收件箱", "邮箱管理", "设置", "退出登录"]) {
      expect(within(nav).getByRole("button", { name: label })).toBeTruthy();
    }
    expect(within(nav).queryByRole("button", { name: "域名" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "审计" })).toBeNull();
    await user.click(within(nav).getByRole("button", { name: "设置" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy());
    expect(screen.getByRole("button", { name: /域名设置/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /审计记录/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /邮件翻译/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开导航菜单" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps old domain and audit routes compatible", async () => {
    window.history.replaceState({}, "", "/domains");
    const { unmount } = render(<App />);
    expect(await screen.findByRole("heading", { name: "域名设置" })).toBeTruthy();
    unmount();
    window.history.replaceState({}, "", "/audit");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "审计记录" })).toBeTruthy();
  });
});
