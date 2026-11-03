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
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/auth/session") return json({ csrfToken: "test-csrf" });
      if (url.startsWith("/api/mailboxes?stats=1&search=")) return json([]);
      if (url === "/api/domains") return json([]);
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
    for (const label of ["收件箱", "邮箱管理", "域名", "审计", "退出登录"]) {
      expect(within(nav).getByRole("button", { name: label })).toBeTruthy();
    }
    await user.click(within(nav).getByRole("button", { name: "域名" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "域名设置" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "打开导航菜单" }).getAttribute("aria-expanded")).toBe("false");
  });
});
