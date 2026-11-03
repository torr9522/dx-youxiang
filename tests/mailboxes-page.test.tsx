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
const secondMailbox = { ...mailbox, id: 8, address: "beta@example.test", local_part: "beta", unreadEmails: 0, totalEmails: 0 };

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
}

describe("mailbox management", () => {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/mailboxes?stats=1")) return json([mailbox, secondMailbox]);
    if (url === "/api/domains") return json([{ id: 2, name: "example.test", is_default: 1, enabled: 1 }]);
    if (url === "/api/mailboxes/7/external-login" && init?.method === "PATCH") return Promise.resolve(new Response(null, { status: 204 }));
    if (url === "/api/mailboxes/7/password" && init?.method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
    if (url === "/api/mailboxes/7" && init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    if (url === "/api/mailboxes/8" && init?.method === "DELETE") return json({ error: "邮件核心操作失败" }, 502);
    if (url === "/api/mailboxes/bulk" && init?.method === "POST") return json({ total: 10, succeeded: 10, skippedExisting: 0, duplicates: 0, failed: 0, results: [] }, 207);
    if (url === "/api/mailboxes/bulk-delete" && init?.method === "POST") {
      const ids = (JSON.parse(String(init.body)) as { ids: number[] }).ids;
      const results = ids.map((id) => id === 8
        ? { id, address: secondMailbox.address, status: "failed", reason: "邮件核心操作失败" }
        : { id, address: mailbox.address, status: "deleted" });
      return json({ total: ids.length, deleted: results.filter((item) => item.status === "deleted").length, failed: results.filter((item) => item.status === "failed").length, results }, 207);
    }
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("creates an inclusive numeric range and rejects invalid or oversized ranges", async () => {
    const user = userEvent.setup();
    render(<MailboxesPage onMailbox={() => undefined} />);
    await screen.findAllByText(mailbox.address);
    await user.click(screen.getByRole("button", { name: "批量创建" }));
    const dialog = screen.getByRole("dialog");
    const start = within(dialog).getByLabelText("起始编号");
    const end = within(dialog).getByLabelText("结束编号");
    expect(within(dialog).getByText("预计 10 个 / 上限 100")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "开始创建" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mailboxes/bulk",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ localParts: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] }) }),
    ));
    expect(await within(dialog).findByText("成功 10，已存在跳过 0，本批重复 0，失败 0")).toBeTruthy();

    await user.clear(start); await user.type(start, "20");
    await user.clear(end); await user.type(end, "10");
    expect(within(dialog).getByText("起始编号必须小于或等于结束编号")).toBeTruthy();
    await user.clear(start); await user.type(start, "abc");
    expect(within(dialog).getByText("起始编号和结束编号必须是非负整数")).toBeTruthy();
    await user.clear(start); await user.type(start, "1");
    await user.clear(end); await user.type(end, "101");
    expect(within(dialog).getByText("每次最多创建 100 个邮箱，请缩小范围")).toBeTruthy();
  });

  it("preserves manual rows across modes, removes only the selected row and ignores blanks", async () => {
    const user = userEvent.setup();
    render(<MailboxesPage onMailbox={() => undefined} />);
    await screen.findAllByText(mailbox.address);
    await user.click(screen.getByRole("button", { name: "批量创建" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "逐行自定义" }));
    await user.type(within(dialog).getByLabelText("邮箱前缀 1"), "first");
    await user.click(within(dialog).getByRole("button", { name: "添加一行" }));
    await user.type(within(dialog).getByLabelText("邮箱前缀 2"), "middle");
    await user.click(within(dialog).getByRole("button", { name: "添加一行" }));
    await user.type(within(dialog).getByLabelText("邮箱前缀 3"), "last");
    await user.click(within(dialog).getByRole("button", { name: "删除第 2 行" }));
    expect((within(dialog).getByLabelText("邮箱前缀 1") as HTMLInputElement).value).toBe("first");
    expect((within(dialog).getByLabelText("邮箱前缀 2") as HTMLInputElement).value).toBe("last");

    await user.click(within(dialog).getByRole("button", { name: "添加一行" }));
    await user.click(within(dialog).getByRole("button", { name: "范围创建" }));
    await user.click(within(dialog).getByRole("button", { name: "逐行自定义" }));
    expect((within(dialog).getByLabelText("邮箱前缀 1") as HTMLInputElement).value).toBe("first");
    await user.click(within(dialog).getByRole("button", { name: "开始创建" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mailboxes/bulk",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ localParts: ["first", "last"] }) }),
    ));
  });

  it("supports single, multiple, select-all and clear selection", async () => {
    const user = userEvent.setup();
    render(<MailboxesPage onMailbox={() => undefined} />);
    await screen.findAllByText(mailbox.address);
    await user.click(screen.getAllByLabelText(`选择 ${mailbox.address}`)[0]);
    expect(screen.getByText("已选择 1 个邮箱")).toBeTruthy();
    await user.click(screen.getAllByLabelText(`选择 ${secondMailbox.address}`)[0]);
    expect(screen.getByText("已选择 2 个邮箱")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "取消选择" }));
    expect(screen.queryByText(/已选择/)).toBeNull();
    await user.click(screen.getByLabelText("全选当前列表"));
    expect(screen.getByText("已选择 2 个邮箱")).toBeTruthy();
    await user.click(screen.getByLabelText("全选当前列表"));
    expect(screen.queryByText(/已选择/)).toBeNull();
  });

  it("uses one bulk confirmation and keeps failed ids available for retry", async () => {
    const user = userEvent.setup();
    render(<MailboxesPage onMailbox={() => undefined} />);
    await screen.findAllByText(mailbox.address);
    await user.click(screen.getByLabelText("全选当前列表"));
    await user.click(screen.getByRole("button", { name: "批量删除" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/确定删除选中的/)).toBeTruthy();
    expect(within(dialog).getByText("2", { selector: "strong" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确定删除" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mailboxes/bulk-delete",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: [7, 8] }) }),
    ));
    expect(await within(dialog).findByText("成功删除 1，失败 1")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "重试失败项" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mailboxes/bulk-delete",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: [8] }) }),
    ));
  });

  it("uses a simple confirmation and calls the real deletion endpoint without an address body", async () => {
    const user = userEvent.setup();
    render(<MailboxesPage onMailbox={() => undefined} />);
    await screen.findAllByText(mailbox.address);

    await user.click(screen.getAllByLabelText("删除邮箱")[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).getByText(mailbox.address)).toBeTruthy();
    const submit = within(dialog).getByRole("button", { name: "确定删除" });
    await user.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mailboxes/7",
      expect.objectContaining({ method: "DELETE" }),
    ));
    const deletionCall = fetchMock.mock.calls.find(([url, init]) => url === "/api/mailboxes/7" && init?.method === "DELETE");
    expect(deletionCall?.[1]?.body).toBeUndefined();
  });

  it("shows a real single-delete error without hiding the mailbox", async () => {
    const user = userEvent.setup();
    render(<MailboxesPage onMailbox={() => undefined} />);
    await screen.findAllByText(secondMailbox.address);
    await user.click(screen.getAllByLabelText("删除邮箱")[1]);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确定删除" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("邮件核心操作失败");
    expect(screen.getAllByText(secondMailbox.address).length).toBeGreaterThan(0);
  });
});
