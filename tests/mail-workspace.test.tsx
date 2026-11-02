// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MailWorkspacePage } from "../src/client/pages/MailWorkspacePage";
import { copyText } from "../src/client/lib/clipboard";

const mailbox = {
  id: 7,
  address: "alpha@example.test",
  local_part: "alpha",
  domain: "example.test",
  note: "",
  external_login: 0,
  status: "active",
  created_at: "2026-01-01 00:00:00",
  unreadEmails: 1,
  totalEmails: 1,
};

const message = {
  id: "m1",
  receivedAt: "2026-01-02T03:04:05Z",
  from: [{ name: "Example", email: "sender@example.test" }],
  to: [{ email: mailbox.address }],
  subject: "登录验证码",
  keywords: {},
  hasAttachment: true,
  preview: "验证码已生成",
};

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
}

describe("mail workspace", () => {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/mailboxes?stats=1&search=")) return json([mailbox]);
    if (url === "/api/domains") return json([{ id: 2, name: "example.test", is_default: 1, enabled: 1 }]);
    if (url.startsWith("/api/mailboxes/7/messages?") && (!init?.method || init.method === "GET")) return json({ list: [message], total: 1, position: 0 });
    if (url === "/api/mailboxes/7/messages/m1" && (!init?.method || init.method === "GET")) return json({ ...message, plain: "Your code is 482731", html: "", blockedRemoteImages: false, verificationCode: "482731", attachments: [{ blobId: "b1", name: "notice.txt", size: 12 }] });
    if (url === "/api/mailboxes/7/messages/m1/read" && init?.method === "PATCH") return Promise.resolve(new Response(null, { status: 204 }));
    if (url === "/api/mailboxes" && init?.method === "POST") return json({ id: 8, address: "created@example.test", external_login: 0 }, 201);
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads real mailbox/message endpoints and persists the read flag", async () => {
    const user = userEvent.setup();
    render(<MailWorkspacePage onManage={() => undefined} />);

    expect((await screen.findAllByText(mailbox.address)).length).toBeGreaterThan(0);
    await user.click(await screen.findByText(message.subject));

    expect(await screen.findByText("482731")).toBeTruthy();
    expect(screen.getByText("notice.txt")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mailboxes/7/messages/m1/read",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ read: true }) }),
    ));
  });

  it("sends mailbox and message searches to backend query parameters", async () => {
    const user = userEvent.setup();
    render(<MailWorkspacePage onManage={() => undefined} />);
    await screen.findByText(message.subject);

    const mailboxSearch = screen.getByLabelText("搜索邮箱");
    await user.type(mailboxSearch, "alpha");
    await user.click(screen.getByLabelText("执行邮箱搜索"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/mailboxes?stats=1&search=alpha")).toBe(true));

    const messageSearch = screen.getByLabelText("搜索当前邮箱");
    await user.type(messageSearch, "验证码");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("q=%E9%AA%8C%E8%AF%81%E7%A0%81"))).toBe(true));
  });

  it("creates a mailbox through the production API contract", async () => {
    const user = userEvent.setup();
    render(<MailWorkspacePage onManage={() => undefined} />);
    await screen.findByText(message.subject);

    await user.click(screen.getByLabelText("创建邮箱"));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("邮箱前缀"), "created");
    expect(within(dialog).getByText("created@example.test")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "创建邮箱" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/mailboxes" && init?.method === "POST" && init.body === JSON.stringify({ localPart: "created", domainId: 2, note: "" }))).toBe(true));
  });
});

describe("clipboard fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("copies over plain HTTP without requiring Clipboard API", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    await copyText("alpha@example.test");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
