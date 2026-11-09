// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MailboxGroupsSidebar } from "../src/client/components/MailboxGroupsSidebar";
import { beginMailReadSession, clearMailReadCache, fetchMailRead, getMailReadCache, mailReadKey } from "../src/client/lib/mail-read-cache";

const groups = [
  { id: 1, name: "私人邮箱", sort_order: 0, is_system_default: 1, mailbox_count: 1, created_at: "2026-01-01", updated_at: "2026-01-01" },
  { id: 2, name: "工作", sort_order: 1, is_system_default: 0, mailbox_count: 1, created_at: "2026-01-01", updated_at: "2026-01-01" },
  { id: 3, name: "朋友", sort_order: 2, is_system_default: 0, mailbox_count: 0, created_at: "2026-01-01", updated_at: "2026-01-01" },
];

const mailboxes = [
  { id: 7, address: "alpha@example.test", local_part: "alpha", domain: "example.test", group_id: 1, note: "", external_login: 0, email_send: 0, status: "active", created_at: "2026-01-01", unreadEmails: 1, totalEmails: 2 },
  { id: 8, address: "work@example.test", local_part: "work", domain: "example.test", group_id: 2, note: "", external_login: 0, email_send: 0, status: "active", created_at: "2026-01-01", unreadEmails: 0, totalEmails: 0 },
];

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
}

describe("grouped mailbox sidebar", () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const onCreateMailbox = vi.fn();
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/mailbox-groups/reorder" && init?.method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
    if (url === "/api/mailboxes/7/group" && init?.method === "PATCH") return Promise.resolve(new Response(null, { status: 204 }));
    if (url === "/api/mailbox-groups/2" && init?.method === "PATCH") return json({ ...groups[1], name: "工作邮箱" });
    if (url === "/api/mailbox-groups/2/delete-preview") return json({
      group: groups[1],
      mailboxes: [{ id: 8, address: "work@example.test", status: "active" }],
      memberVersion: "a".repeat(64),
      confirmation: "DELETE 1",
    });
    if (url === "/api/mailbox-groups/2/delete" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return body.mode === "DELETE_WITH_MAILBOXES"
        ? json({ status: "deleted", groupDeleted: true, deleted: [{ id: 8, address: "work@example.test" }] })
        : json({ status: "moved", groupDeleted: true, targetGroupId: 1, moved: 1 });
    }
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearMailReadCache();
    beginMailReadSession("admin");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderSidebar = () => render(<MailboxGroupsSidebar
    groups={groups}
    mailboxes={mailboxes}
    selectedMailboxId={7}
    pendingMailboxId={null}
    onSelectMailbox={() => undefined}
    onCopyMailbox={() => undefined}
    onCreateMailbox={onCreateMailbox}
    onChanged={onChanged}
  />);

  it("collapses groups and keeps the renamed system default protected", async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.getByText("alpha@example.test")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "私人邮箱1" }));
    expect(screen.queryByText("alpha@example.test")).toBeNull();
    await user.click(screen.getByRole("button", { name: "私人邮箱 分组操作" }));
    expect(screen.getByRole("button", { name: "重命名" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "删除分组" })).toBeNull();
    expect(screen.queryByRole("button", { name: "上移" })).toBeNull();
  });

  it("supports move-up controls and desktop drag sorting", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "朋友 分组操作" }));
    await user.click(screen.getByRole("button", { name: "上移" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mailbox-groups/reorder", expect.objectContaining({
      method: "POST", body: JSON.stringify({ groupIds: [3, 2] }),
    })));

    fetchMock.mockClear();
    const work = container.querySelector('[data-mailbox-group-id="2"]')!;
    const friends = container.querySelector('[data-mailbox-group-id="3"]')!;
    fireEvent.dragStart(work);
    fireEvent.dragOver(friends);
    fireEvent.drop(friends);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mailbox-groups/reorder", expect.objectContaining({
      method: "POST", body: JSON.stringify({ groupIds: [3, 2] }),
    })));
  });

  it("moves a mailbox without changing the active selection and defaults creation to its group", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "移动 alpha@example.test" }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("目标分组"), "2");
    await user.click(within(dialog).getByRole("button", { name: "移动" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mailboxes/7/group", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ groupId: 2 }),
    })));

    await user.click(screen.getByRole("button", { name: "工作 分组操作" }));
    await user.click(screen.getByRole("button", { name: "在此组创建邮箱" }));
    expect(onCreateMailbox).toHaveBeenCalledWith(2);
  });

  it("shows all deletion meanings and sends the stable default migration mode", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "工作 分组操作" }));
    await user.click(screen.getByRole("button", { name: "删除分组" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("移动到默认分组“私人邮箱”")).toBeTruthy();
    expect(within(dialog).getByText("移动到指定分组")).toBeTruthy();
    expect(within(dialog).getByText("删除分组和全部邮箱")).toBeTruthy();
    expect(within(dialog).getByText("work@example.test")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "迁移并删除分组" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mailbox-groups/2/delete", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ mode: "MOVE_TO_DEFAULT", memberVersion: "a".repeat(64) }),
    })));
  });

  it("requires typed confirmation and clears only caches for accounts actually deleted", async () => {
    const deletedKey = mailReadKey("detail", [8, "message-a"]);
    const preservedKey = mailReadKey("detail", [7, "message-b"]);
    await fetchMailRead(deletedKey, async () => ({ plain: "deleted" }));
    await fetchMailRead(preservedKey, async () => ({ plain: "preserved" }));
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "工作 分组操作" }));
    await user.click(screen.getByRole("button", { name: "删除分组" }));
    const dialog = screen.getByRole("dialog");
    await user.click(await within(dialog).findByText("删除分组和全部邮箱"));
    const confirmation = within(dialog).getByLabelText("输入 DELETE 1 确认");
    expect((within(dialog).getByRole("button", { name: "永久删除" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(confirmation, "DELETE 1");
    await user.click(within(dialog).getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mailbox-groups/2/delete", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ mode: "DELETE_WITH_MAILBOXES", memberVersion: "a".repeat(64), confirmation: "DELETE 1" }),
    })));
    expect(getMailReadCache(deletedKey)).toBeNull();
    expect(getMailReadCache(preservedKey)?.value).toEqual({ plain: "preserved" });
  });
});
