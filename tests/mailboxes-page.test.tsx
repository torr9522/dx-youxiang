// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MailboxesPage } from "../src/client/pages/MailboxesPage";

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
  totalEmails: 2,
};

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
}

describe("mailbox management", () => {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/mailboxes?stats=1")) return json([mailbox]);
    if (url === "/api/domains") return json([{ id: 2, name: "example.test", is_default: 1, enabled: 1 }]);
    if (url === "/api/mailboxes/7/external-login" && init?.method === "PATCH") return Promise.resolve(new Response(null, { status: 204 }));
    if (url === "/api/mailboxes/7/password" && init?.method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
    if (url === "/api/mailboxes/7" && init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
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

  it("enables external login through the existing API with a six-character password", async () => {
    const user = userEvent.setup();
    render(<MailboxesPage onMailbox={() => undefined} />);
    await screen.findAllByText(mailbox.address);

    await user.click(screen.getAllByLabelText("开启外部登录")[0]);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^独立密码/), "123456");
    await user.click(within(dialog).getByRole("button", { name: "设置密码并开启" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mailboxes/7/external-login",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: true, password: "123456" }) }),
    ));
  });

  it("resets the independent password through the existing API", async () => {
    const user = userEvent.setup();
    render(<MailboxesPage onMailbox={() => undefined} />);
    await screen.findAllByText(mailbox.address);

    await user.click(screen.getAllByLabelText("重置密码")[0]);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText("新密码（至少 6 个字符）"), "aaaaaa");
    await user.click(within(dialog).getByRole("button", { name: "重置密码" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mailboxes/7/password",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ password: "aaaaaa" }) }),
    ));
    expect(await within(dialog).findByText("密码已重置")).toBeTruthy();
  });

  it("requires the full address and calls the real deletion endpoint", async () => {
    const user = userEvent.setup();
    render(<MailboxesPage onMailbox={() => undefined} />);
    await screen.findAllByText(mailbox.address);

    await user.click(screen.getAllByLabelText("删除邮箱")[0]);
    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "永久删除" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("输入完整地址确认"), mailbox.address);
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mailboxes/7",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirm: mailbox.address }) }),
    ));
  });
});
