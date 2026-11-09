// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router";
import { App } from "../src/client/App";

function json(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }));
}

const mailboxGroup = { id: 1, name: "dx", sort_order: 0, is_system_default: 1, mailbox_count: 1, created_at: "2026-01-01", updated_at: "2026-01-01" };

describe("mobile application navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/auth/session") return json({ csrfToken: "test-csrf" });
      if (/^\/api\/mailboxes\?stats=[01]&search=/.test(url)) return json([]);
      if (url === "/api/mailbox-groups") return json([mailboxGroup]);
      if (url === "/api/domains") return json([]);
      if (url === "/api/mailboxes/7/folders") return json([]);
      if (url === "/api/audit") return json([]);
      throw new Error(`Unexpected request: ${url}`);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderApp = () => render(<BrowserRouter><App /></BrowserRouter>);

  it("keeps every page available through a labelled compact menu", async () => {
    const user = userEvent.setup();
    renderApp();
    const menuButton = await screen.findByRole("button", { name: "打开导航菜单" });
    await user.click(menuButton);

    const nav = screen.getByRole("navigation", { name: "手机导航" });
    for (const label of ["收件箱", "邮箱管理", "设置", "退出登录"]) {
      expect(within(nav).getByRole(label === "退出登录" ? "button" : "link", { name: label })).toBeTruthy();
    }
    expect(within(nav).queryByRole("button", { name: "域名" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "审计" })).toBeNull();
    await user.click(within(nav).getByRole("link", { name: "设置" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy());
    expect(window.location.pathname).toBe("/settings");
    expect(screen.getByRole("button", { name: /域名设置/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /审计记录/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /邮件翻译/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开导航菜单" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps old domain and audit routes compatible", async () => {
    window.history.replaceState({}, "", "/domains");
    const { unmount } = renderApp();
    expect(await screen.findByRole("heading", { name: "域名设置" })).toBeTruthy();
    unmount();
    window.history.replaceState({}, "", "/audit");
    renderApp();
    expect(await screen.findByRole("heading", { name: "审计记录" })).toBeTruthy();
    expect(window.location.pathname).toBe("/settings/audit");
  });

  it("records settings navigation in browser history and restores it on back and forward", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "退出登录" });
    await user.click(screen.getByTitle("设置"));
    await screen.findByRole("heading", { name: "设置" });
    await user.click(screen.getByRole("button", { name: /邮件翻译/ }));
    await screen.findByRole("heading", { name: "邮件翻译" });
    expect(window.location.pathname).toBe("/settings/translation");
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/settings"));
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/settings/translation"));
  });

  it("routes mailbox and message selections through browser back and forward", async () => {
    const mailbox = { id: 7, address: "alpha@example.test", local_part: "alpha", domain: "example.test", group_id: 1, note: "", external_login: 0, status: "active", created_at: "2026-01-01", unreadEmails: 1, totalEmails: 1 };
    const message = { id: "m1", receivedAt: "2026-01-02T03:04:05Z", from: [{ email: "sender@example.test" }], to: [{ email: mailbox.address }], subject: "Route test message", keywords: { "$seen": true }, hasAttachment: false, preview: "Route body" };
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/auth/session") return json({ csrfToken: "test-csrf" });
      if (/^\/api\/mailboxes\?stats=[01]&search=/.test(url)) return json([mailbox]);
      if (url === "/api/mailbox-groups") return json([mailboxGroup]);
      if (url === "/api/domains") return json([]);
      if (url === "/api/mailboxes/7/folders") return json([]);
      if (url.startsWith("/api/mailboxes/7/messages?")) return json({ list: [message], total: 1, position: 0 });
      if (url === "/api/mailboxes/7/messages/m1") return json({ ...message, plain: "Route body", html: "<p>Route body</p>", blockedRemoteImages: false, attachments: [], translation: { language: "eng", label: "英文", translatable: true, configured: false, enabled: false, targetLanguage: "zh-CN" } });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const user = userEvent.setup();
    renderApp();
    await screen.findAllByText(mailbox.address);
    const mailboxList = screen.getByLabelText("邮箱列表");
    await user.click(within(mailboxList).getByText(mailbox.address));
    await waitFor(() => expect(window.location.pathname).toBe("/inbox/7"));
    await user.click(await screen.findByText(message.subject));
    const detail = screen.getByLabelText("邮件详情");
    expect(await within(detail).findByText("Route body")).toBeTruthy();
    expect(window.location.pathname).toBe("/inbox/7/m1");

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/inbox/7"));
    await waitFor(() => expect(within(detail).queryByText("Route body")).toBeNull());
    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/inbox/7/m1"));
    expect(await within(detail).findByText("Route body")).toBeTruthy();
  });

  it("loads a message directly from its browser URL", async () => {
    window.history.replaceState({}, "", "/inbox/7/m1");
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/auth/session") return json({ csrfToken: "test-csrf" });
      if (/^\/api\/mailboxes\?stats=[01]&search=/.test(url)) return json([{ id: 7, address: "alpha@example.test", local_part: "alpha", domain: "example.test", group_id: 1, note: "", external_login: 0, status: "active", created_at: "2026-01-01", unreadEmails: 0, totalEmails: 1 }]);
      if (url === "/api/mailbox-groups") return json([mailboxGroup]);
      if (url === "/api/domains") return json([]);
      if (url === "/api/mailboxes/7/folders") return json([]);
      if (url.startsWith("/api/mailboxes/7/messages?")) return json({ list: [], total: 1, position: 0 });
      if (url === "/api/mailboxes/7/messages/m1") return json({ id: "m1", subject: "Direct route", receivedAt: "2026-01-02T03:04:05Z", from: [], to: [], keywords: { "$seen": true }, hasAttachment: false, preview: "Direct body", plain: "Direct body", html: "<p>Direct body</p>", blockedRemoteImages: false, attachments: [], translation: { language: "eng", label: "英文", translatable: true, configured: false, enabled: false, targetLanguage: "zh-CN" } });
      throw new Error(`Unexpected request: ${url}`);
    }));
    renderApp();
    expect(await screen.findByText("Direct body")).toBeTruthy();
    expect(window.location.pathname).toBe("/inbox/7/m1");
  });

  it("loads Junk directly and preserves its folder context in message URLs", async () => {
    window.history.replaceState({}, "", "/inbox/7/junk");
    const mailbox = { id: 7, address: "alpha@example.test", local_part: "alpha", domain: "example.test", group_id: 1, note: "", external_login: 0, email_send: 0, status: "active", created_at: "2026-01-01", unreadEmails: 0, totalEmails: 0 };
    const message = { id: "spam-1", receivedAt: "2026-01-02T03:04:05Z", from: [{ email: "sender@example.test" }], to: [{ email: mailbox.address }], subject: "Junk route message", keywords: { "$junk": true }, hasAttachment: false, preview: "Junk body" };
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/auth/session") return json({ csrfToken: "test-csrf" });
      if (/^\/api\/mailboxes\?stats=[01]&search=/.test(url)) return json([mailbox]);
      if (url === "/api/mailbox-groups") return json([mailboxGroup]);
      if (url === "/api/domains") return json([]);
      if (url === "/api/mailboxes/7/folders") return json([{ role: "junk", id: "junk-id", name: "Junk Mail", totalEmails: 1, unreadEmails: 1 }]);
      if (url.startsWith("/api/mailboxes/7/messages?") && url.includes("folder=junk")) return json({ list: [message], total: 1, position: 0 });
      if (url === "/api/mailboxes/7/messages/spam-1") return json({ ...message, plain: "Junk body", html: "<p>Junk body</p>", blockedRemoteImages: false, attachments: [], translation: { language: "eng", label: "英文", translatable: true, configured: false, enabled: false, targetLanguage: "zh-CN" } });
      if (url.endsWith("/read")) return Promise.resolve(new Response(null, { status: 204 }));
      throw new Error(`Unexpected request: ${url}`);
    }));
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByText(message.subject));
    const detail = screen.getByLabelText("邮件详情");
    expect(await within(detail).findByText("Junk body")).toBeTruthy();
    expect(window.location.pathname).toBe("/inbox/7/junk/spam-1");
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/inbox/7/junk"));
    await waitFor(() => expect(within(detail).queryByText("Junk body")).toBeNull());
  });

  it("restores a safe deep link after login and rejects an external return URL", async () => {
    window.history.replaceState({}, "", "/settings/translation");
    let authenticated = false;
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/session") return authenticated ? json({ csrfToken: "test-csrf" }) : Promise.resolve(new Response(JSON.stringify({ error: "需要管理员登录" }), { status: 401, headers: { "content-type": "application/json" } }));
      if (url === "/api/auth/login" && init?.method === "POST") { authenticated = true; return json({ csrfToken: "test-csrf" }); }
      if (url === "/api/settings/translation") return json({ protocol: null, baseUrl: "", hasApiKey: false, model: "", targetLanguage: "zh-CN", enabled: false, configured: false, tested: false, cacheEntries: 0 });
      if (/^\/api\/mailboxes\?stats=[01]&search=/.test(url)) return json([]);
      if (url === "/api/mailbox-groups") return json([mailboxGroup]);
      if (url === "/api/domains") return json([]);
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "登录" });
    expect(window.location.pathname).toBe("/login");
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/settings/translation");
    await user.type(screen.getByLabelText("密码"), "test-password");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await screen.findByRole("heading", { name: "邮件翻译" });
    expect(window.location.pathname).toBe("/settings/translation");

    cleanup();
    window.history.replaceState({}, "", "/login?next=https%3A%2F%2Fevil.example%2Fsteal");
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/inbox"));
  });
});
