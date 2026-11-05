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
  email_send: 1,
  status: "active",
  created_at: "2026-01-01 00:00:00",
  unreadEmails: 1,
  totalEmails: 1,
};

const disabledMailbox = {
  ...mailbox,
  id: 8,
  address: "disabled@example.test",
  local_part: "disabled",
  email_send: 0,
  unreadEmails: 0,
  totalEmails: 0,
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
  let mailboxRows = [mailbox];
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/mailboxes?stats=1&search=")) return json(mailboxRows);
    if (url === "/api/domains") return json([{ id: 2, name: "example.test", is_default: 1, enabled: 1 }]);
    if (url.startsWith("/api/mailboxes/7/messages?") && (!init?.method || init.method === "GET")) return json({ list: [message], total: 1, position: 0 });
    if (url.startsWith("/api/mailboxes/8/messages?") && (!init?.method || init.method === "GET")) return json({ list: [], total: 0, position: 0 });
    if (url === "/api/mailboxes/7/messages/m1" && (!init?.method || init.method === "GET")) return json({ ...message, plain: "Your code is 482731", html: '<p>Your code is 482731</p><img data-remote-src="/api/proxy/image-token" alt="Remote logo">', blockedRemoteImages: true, verificationCode: "482731", attachments: [{ blobId: "b1", name: "notice.txt", size: 12 }], translation: { language: "eng", label: "英文", translatable: true, configured: true, enabled: true, targetLanguage: "zh-CN" } });
    if (url === "/api/mailboxes/7/messages/m1/translate" && init?.method === "POST") return json({ html: '<p>您的验证码是 482731</p><img data-remote-src="/api/proxy/image-token" alt="Remote logo">', plain: "", cached: false, partial: false });
    if (url === "/api/mailboxes/7/messages/m1/read" && init?.method === "PATCH") return Promise.resolve(new Response(null, { status: 204 }));
    if (url === "/api/mailboxes" && init?.method === "POST") return json({ id: 8, address: "created@example.test", external_login: 0 }, 201);
    if (url === "/api/mailboxes/7/drafts" && init?.method === "POST") return json({ emailId: "draft-1", status: "draft" }, 201);
    if (url === "/api/mailboxes/7/submissions" && init?.method === "POST") return json({ emailId: "sent-1", submissionId: "submission-1", status: "queued" }, 202);
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  });

  beforeEach(() => {
    mailboxRows = [mailbox];
    fetchMock.mockClear();
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
    expect(screen.getByText("12 B")).toBeTruthy();
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

    await user.selectOptions(screen.getByLabelText("阅读状态"), "unread");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("read=unread") && String(url).includes("position=0"))).toBe(true));
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

  it("shows the compose workflow to an admin when the selected mailbox can send", async () => {
    const user = userEvent.setup();
    render(<MailWorkspacePage isAdmin onManage={() => undefined} />);
    await screen.findByText(message.subject);

    await user.click(screen.getByRole("button", { name: "写邮件" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("添加附件")).toBeTruthy();
    await user.type(within(dialog).getByLabelText("收件人"), "recipient@example.test");
    await user.type(within(dialog).getByLabelText("抄送"), "copy@example.test");
    await user.type(within(dialog).getByLabelText("密送"), "blind@example.test");
    await user.type(within(dialog).getByLabelText("主题"), "Admin draft");
    await user.type(within(dialog).getByPlaceholderText("邮件正文"), "Draft body");
    await user.click(within(dialog).getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mailboxes/7/drafts", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"subject":"Admin draft"'),
    })));
  });

  it("updates the admin compose permission immediately when switching mailboxes", async () => {
    mailboxRows = [mailbox, disabledMailbox];
    const user = userEvent.setup();
    render(<MailWorkspacePage isAdmin onManage={() => undefined} />);
    await screen.findByText(message.subject);
    expect(screen.getByRole("button", { name: "写邮件" })).toBeTruthy();

    const mailboxList = screen.getByLabelText("邮箱列表");
    await user.click(within(mailboxList).getByText(disabledMailbox.address));
    await waitFor(() => expect(screen.queryByRole("button", { name: "写邮件" })).toBeNull());
    await user.click(within(mailboxList).getByText(mailbox.address));
    await waitFor(() => expect(screen.getByRole("button", { name: "写邮件" })).toBeTruthy());
  });

  it("removes a stale compose action when refreshed permissions disable sending", async () => {
    const user = userEvent.setup();
    render(<MailWorkspacePage isAdmin onManage={() => undefined} />);
    await screen.findByText(message.subject);
    expect(screen.getByRole("button", { name: "写邮件" })).toBeTruthy();

    mailboxRows = [{ ...mailbox, email_send: 0 }];
    await user.click(screen.getByRole("button", { name: "刷新邮件" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "写邮件" })).toBeNull());
  });

  it("preserves the mailbox-user compose matrix", async () => {
    const { unmount } = render(<MailWorkspacePage isAdmin={false} onManage={() => undefined} />);
    await screen.findByText(message.subject);
    expect(screen.getByRole("button", { name: "写邮件" })).toBeTruthy();
    unmount();

    mailboxRows = [disabledMailbox];
    render(<MailWorkspacePage isAdmin={false} onManage={() => undefined} />);
    expect((await screen.findAllByText(disabledMailbox.address)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "写邮件" })).toBeNull();
  });

  it("opens the message stage when launched for a selected mailbox", async () => {
    render(<MailWorkspacePage initialMailboxId={7} onManage={() => undefined} />);
    await screen.findByText(message.subject);
    expect(screen.getByLabelText("邮件列表").className).toContain("flex");
    expect(screen.getByLabelText("邮箱列表").className).toContain("hidden");
  });

  it("loads a message directly from a mailbox/message route", async () => {
    render(<MailWorkspacePage initialMailboxId={7} initialMessageId="m1" onManage={() => undefined} />);
    expect(await screen.findByText("Your code is 482731")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/mailboxes/7/messages/m1")).toBe(true);
    expect(screen.getByLabelText("邮件详情").className).toContain("flex");
  });

  it("reports mailbox and message selections to the browser router", async () => {
    const user = userEvent.setup();
    const onMailboxRoute = vi.fn();
    const onMessageRoute = vi.fn();
    render(<MailWorkspacePage onManage={() => undefined} onMailboxRoute={onMailboxRoute} onMessageRoute={onMessageRoute} />);
    const mailboxList = await screen.findByLabelText("邮箱列表");
    await user.click(within(mailboxList).getByText(mailbox.address));
    expect(onMailboxRoute).toHaveBeenCalledWith(7);
    await user.click(await screen.findByText(message.subject));
    expect(onMessageRoute).toHaveBeenCalledWith(7, "m1");
  });

  it("applies browser back from a message route without reloading the message list", async () => {
    const { rerender } = render(<MailWorkspacePage initialMailboxId={7} initialMessageId="m1" onManage={() => undefined} />);
    expect(await screen.findByText("Your code is 482731")).toBeTruthy();
    const listCallsBefore = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/mailboxes/7/messages?")).length;
    rerender(<MailWorkspacePage initialMailboxId={7} onManage={() => undefined} />);
    await waitFor(() => expect(screen.queryByText("Your code is 482731")).toBeNull());
    expect(screen.getByLabelText("邮件列表").className).toContain("flex");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/mailboxes/7/messages?")).length).toBe(listCallsBefore);
  });

  it("loads remote images only after per-message consent and can hide them again", async () => {
    const user = userEvent.setup();
    render(<MailWorkspacePage onManage={() => undefined} />);
    await user.click(await screen.findByText(message.subject));
    const image = await screen.findByAltText("Remote logo") as HTMLImageElement;
    expect(image.hasAttribute("src")).toBe(false);
    expect(screen.getByText("检测到远程图片。为保护隐私，图片尚未加载。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "显示本封邮件的图片" }));
    await waitFor(() => expect(image.getAttribute("src")).toBe("/api/proxy/image-token"));
    await user.click(screen.getByRole("button", { name: "隐藏远程图片" }));
    await waitFor(() => expect(image.hasAttribute("src")).toBe(false));
  });

  it("translates in place and switches back without a second API request", async () => {
    const user = userEvent.setup();
    render(<MailWorkspacePage onManage={() => undefined} />);
    await user.click(await screen.findByText(message.subject));
    expect(await screen.findByText("Your code is 482731")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "翻译正文" }));
    expect(await screen.findByText("您的验证码是 482731")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "查看原文" }));
    expect(await screen.findByText("Your code is 482731")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "查看译文" }));
    expect(await screen.findByText("您的验证码是 482731")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/mailboxes/7/messages/m1/translate")).toHaveLength(1);
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
