import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Copy, FolderInput, GripVertical, MailPlus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type Mailbox, type MailboxGroup } from "../api";
import { invalidateMailboxReadCache } from "../lib/mail-read-cache";
import { Modal } from "./Modal";

type DeletePreview = {
  group: MailboxGroup;
  mailboxes: Array<{ id: number; address: string; status: string }>;
  memberVersion: string;
  confirmation: string;
};

type Props = {
  groups: MailboxGroup[];
  mailboxes: Mailbox[];
  selectedMailboxId: number | null;
  pendingMailboxId: number | null;
  onSelectMailbox: (mailbox: Mailbox) => void;
  onCopyMailbox: (address: string) => void;
  onCreateMailbox: (groupId: number) => void;
  onChanged: () => Promise<void> | void;
};

export function MailboxGroupsSidebar({ groups, mailboxes, selectedMailboxId, pendingMailboxId, onSelectMailbox, onCopyMailbox, onCreateMailbox, onChanged }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [menuGroupId, setMenuGroupId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ kind: "create" | "rename"; group?: MailboxGroup } | null>(null);
  const [movingMailbox, setMovingMailbox] = useState<Mailbox | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<MailboxGroup | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<number | null>(null);
  const orderedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const ordinaryGroups = orderedGroups.filter((group) => !group.is_system_default);

  const reorder = async (groupIds: number[]) => {
    await api("/api/mailbox-groups/reorder", { method: "POST", body: JSON.stringify({ groupIds }) });
    setMenuGroupId(null);
    await onChanged();
  };

  const moveGroup = async (group: MailboxGroup, offset: -1 | 1) => {
    const index = ordinaryGroups.findIndex((candidate) => candidate.id === group.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ordinaryGroups.length) return;
    const ids = ordinaryGroups.map((candidate) => candidate.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorder(ids);
  };

  const dropGroup = async (targetId: number) => {
    if (draggedGroupId === null || draggedGroupId === targetId) return setDraggedGroupId(null);
    const ids = ordinaryGroups.map((group) => group.id);
    const from = ids.indexOf(draggedGroupId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return setDraggedGroupId(null);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDraggedGroupId(null);
    await reorder(ids);
  };

  return <>
    <div className="min-h-0 flex-1 overflow-y-auto py-2">
      {orderedGroups.map((group) => {
        const groupMailboxes = mailboxes.filter((mailbox) => mailbox.group_id === group.id);
        const isCollapsed = collapsed.has(group.id);
        const ordinaryIndex = ordinaryGroups.findIndex((candidate) => candidate.id === group.id);
        return <div
          key={group.id}
          data-mailbox-group-id={group.id}
          draggable={!group.is_system_default}
          onDragStart={() => setDraggedGroupId(group.is_system_default ? null : group.id)}
          onDragEnd={() => setDraggedGroupId(null)}
          onDragOver={(event) => { if (!group.is_system_default && draggedGroupId !== null) event.preventDefault(); }}
          onDrop={() => { if (!group.is_system_default) void dropGroup(group.id); }}
          className={draggedGroupId === group.id ? "opacity-55" : ""}
        >
          <div className="relative mx-2 mb-1 flex min-h-10 items-center rounded-md hover:bg-white">
            {!group.is_system_default && <GripVertical aria-hidden="true" size={14} className="ml-1 hidden shrink-0 text-slate-300 md:block" />}
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                return next;
              })}
              className="focus-ring flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left"
            >
              {isCollapsed ? <ChevronRight size={15} className="shrink-0 text-slate-400" /> : <ChevronDown size={15} className="shrink-0 text-slate-400" />}
              <span title={group.name} className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{group.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-slate-400">{group.mailbox_count}</span>
            </button>
            <button type="button" onClick={() => setMenuGroupId((current) => current === group.id ? null : group.id)} title="分组操作" aria-label={`${group.name} 分组操作`} className="focus-ring mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><MoreHorizontal size={16} /></button>
            {menuGroupId === group.id && <div className="absolute right-1 top-9 z-20 w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
              <GroupMenuButton label="在此组创建邮箱" icon={<MailPlus size={15} />} onClick={() => { setMenuGroupId(null); onCreateMailbox(group.id); }} />
              <GroupMenuButton label="重命名" icon={<Pencil size={15} />} onClick={() => { setMenuGroupId(null); setEditing({ kind: "rename", group }); }} />
              {!group.is_system_default && <>
                <GroupMenuButton label="上移" disabled={ordinaryIndex === 0} icon={<ChevronDown size={15} className="rotate-180" />} onClick={() => void moveGroup(group, -1)} />
                <GroupMenuButton label="下移" disabled={ordinaryIndex === ordinaryGroups.length - 1} icon={<ChevronDown size={15} />} onClick={() => void moveGroup(group, 1)} />
                <GroupMenuButton danger label="删除分组" icon={<Trash2 size={15} />} onClick={() => { setMenuGroupId(null); setDeletingGroup(group); }} />
              </>}
            </div>}
          </div>
          {!isCollapsed && groupMailboxes.map((mailbox) => <div key={mailbox.id} className={`group mx-2 mb-1 ml-5 flex min-h-14 items-center rounded-md border ${mailbox.id === (pendingMailboxId ?? selectedMailboxId) ? "border-blue-200 bg-blue-50" : "border-transparent hover:border-slate-200 hover:bg-white"}`}>
            <button onClick={() => onSelectMailbox(mailbox)} className="focus-ring min-w-0 flex-1 px-3 py-2 text-left">
              <span title={mailbox.address} className={`block truncate text-sm leading-5 ${mailbox.id === (pendingMailboxId ?? selectedMailboxId) ? "font-semibold text-blue-800" : "font-medium text-slate-800"}`}>{mailbox.address}</span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-500"><span>{mailbox.totalEmails ?? "-"} 封</span>{Boolean(mailbox.unreadEmails) && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 font-medium text-white">{mailbox.unreadEmails} 未读</span>}</span>
            </button>
            <button title="移动到其他分组" aria-label={`移动 ${mailbox.address}`} onClick={() => setMovingMailbox(mailbox)} className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-blue-700"><FolderInput size={15} /></button>
            <button title="复制邮箱地址" aria-label={`复制 ${mailbox.address}`} onClick={() => onCopyMailbox(mailbox.address)} className="focus-ring mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-blue-700"><Copy size={15} /></button>
          </div>)}
        </div>;
      })}
      <button type="button" onClick={() => setEditing({ kind: "create" })} className="focus-ring mx-3 mt-2 flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-blue-700 hover:bg-blue-50"><Plus size={16} />新建分组</button>
    </div>
    {editing && <EditGroupDialog state={editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await onChanged(); }} />}
    {movingMailbox && <MoveMailboxDialog mailbox={movingMailbox} groups={orderedGroups} onClose={() => setMovingMailbox(null)} onDone={async () => { setMovingMailbox(null); await onChanged(); }} />}
    {deletingGroup && <DeleteGroupDialog group={deletingGroup} groups={orderedGroups} onClose={() => setDeletingGroup(null)} onChanged={onChanged} onDone={async () => { setDeletingGroup(null); await onChanged(); }} />}
  </>;
}

function GroupMenuButton({ label, icon, onClick, disabled, danger }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`focus-ring flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm disabled:opacity-35 ${danger ? "text-red-700 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"}`}>{icon}{label}</button>;
}

function EditGroupDialog({ state, onClose, onDone }: { state: { kind: "create" | "rename"; group?: MailboxGroup }; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(state.group?.name ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <Modal title={state.kind === "create" ? "新建分组" : "重命名分组"} onClose={onClose}>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        await api(state.kind === "create" ? "/api/mailbox-groups" : `/api/mailbox-groups/${state.group!.id}`, {
          method: state.kind === "create" ? "POST" : "PATCH",
          body: JSON.stringify({ name }),
        });
        onDone();
      } catch (caught) { setError((caught as Error).message); setBusy(false); }
    }}>
      <label className="block text-sm font-medium text-slate-700">分组名称<input autoFocus required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} className="form-control mt-1.5 h-11 w-full px-3" /></label>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-secondary focus-ring h-10 px-4 text-sm">取消</button><button disabled={busy || !name.trim()} className="btn-primary focus-ring h-10 px-4 text-sm">{busy ? "正在保存..." : "保存"}</button></div>
    </form>
  </Modal>;
}

export function MoveMailboxDialog({ mailbox, groups, onClose, onDone }: { mailbox: Mailbox; groups: MailboxGroup[]; onClose: () => void; onDone: () => void }) {
  const [groupId, setGroupId] = useState(mailbox.group_id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <Modal title="移动邮箱" onClose={onClose}>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try { await api(`/api/mailboxes/${mailbox.id}/group`, { method: "PATCH", body: JSON.stringify({ groupId }) }); onDone(); }
      catch (caught) { setError((caught as Error).message); setBusy(false); }
    }}>
      <p title={mailbox.address} className="mb-4 truncate text-sm font-medium text-slate-900">{mailbox.address}</p>
      <label className="block text-sm font-medium text-slate-700">目标分组<select value={groupId} onChange={(event) => setGroupId(Number(event.target.value))} className="form-control mt-1.5 h-11 w-full px-3">{groups.map((group) => <option key={group.id} value={group.id}>{group.name}{group.is_system_default ? "（默认）" : ""}</option>)}</select></label>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-secondary focus-ring h-10 px-4 text-sm">取消</button><button disabled={busy || groupId === mailbox.group_id} className="btn-primary focus-ring h-10 px-4 text-sm">{busy ? "正在移动..." : "移动"}</button></div>
    </form>
  </Modal>;
}

function DeleteGroupDialog({ group, groups, onClose, onChanged, onDone }: { group: MailboxGroup; groups: MailboxGroup[]; onClose: () => void; onChanged: () => Promise<void> | void; onDone: () => void }) {
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [mode, setMode] = useState<"DELETE_WITH_MAILBOXES" | "MOVE_TO_TARGET" | "MOVE_TO_DEFAULT">("MOVE_TO_DEFAULT");
  const [targetGroupId, setTargetGroupId] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const targets = groups.filter((candidate) => candidate.id !== group.id);
  const defaultGroup = targets.find((candidate) => candidate.is_system_default);

  useEffect(() => {
    let active = true;
    void api<DeletePreview>(`/api/mailbox-groups/${group.id}/delete-preview`)
      .then((value) => {
        if (!active) return;
        setPreview(value);
        setTargetGroupId(groups.find((candidate) => candidate.id !== group.id && !candidate.is_system_default)?.id
          ?? groups.find((candidate) => candidate.id !== group.id && candidate.is_system_default)?.id ?? 0);
      })
      .catch((caught) => { if (active) setError((caught as Error).message); });
    return () => { active = false; };
  }, [group.id, groups]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ status: string; deleted?: Array<{ id: number; address: string }>; failed?: { address: string; reason: string }; remaining?: unknown[] }>(`/api/mailbox-groups/${group.id}/delete`, {
        method: "POST",
        body: JSON.stringify({ mode, memberVersion: preview.memberVersion, ...(mode === "MOVE_TO_TARGET" ? { targetGroupId } : {}), ...(mode === "DELETE_WITH_MAILBOXES" ? { confirmation } : {}) }),
      });
      result.deleted?.forEach((mailbox) => invalidateMailboxReadCache(mailbox.id));
      if (result.status === "partial_failure") {
        setError(`${result.failed?.address ?? "邮箱"}：${result.failed?.reason ?? "删除失败"}。已停止后续删除，请核对后重试。`);
        const next = await api<DeletePreview>(`/api/mailbox-groups/${group.id}/delete-preview`);
        setPreview(next); setConfirmation(""); setBusy(false); await onChanged(); return;
      }
      onDone();
    } catch (caught) { setError((caught as Error).message); setBusy(false); }
  };

  return <Modal title="删除分组" onClose={onClose} wide>
    <form onSubmit={submit}>
      <div className="mb-4"><p className="text-sm text-slate-600">分组</p><p className="mt-1 break-words font-semibold text-slate-900">{group.name}</p><p className="mt-1 text-sm text-slate-500">{preview ? `${preview.mailboxes.length} 个邮箱` : "正在读取成员..."}</p></div>
      <div className="space-y-2">
        <DeleteChoice checked={mode === "MOVE_TO_DEFAULT"} onChange={() => setMode("MOVE_TO_DEFAULT")} title={`移动到默认分组${defaultGroup ? `“${defaultGroup.name}”` : ""}`} detail="保留邮箱、邮件、附件和权限，只删除当前分组。" />
        <DeleteChoice checked={mode === "MOVE_TO_TARGET"} onChange={() => setMode("MOVE_TO_TARGET")} title="移动到指定分组" detail="保留全部邮箱数据，并选择新的所属分组。" />
        {mode === "MOVE_TO_TARGET" && <select value={targetGroupId} onChange={(event) => setTargetGroupId(Number(event.target.value))} className="form-control ml-7 h-10 max-w-[calc(100%-1.75rem)] px-3"><option value={0}>选择目标分组</option>{targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>}
        <DeleteChoice danger checked={mode === "DELETE_WITH_MAILBOXES"} onChange={() => setMode("DELETE_WITH_MAILBOXES")} title="删除分组和全部邮箱" detail="永久删除组内邮箱账户及其邮件、附件和文件夹。此操作不可撤销。" />
      </div>
      {preview && preview.mailboxes.length > 0 && <div className="mt-4 max-h-32 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{preview.mailboxes.map((mailbox) => <div key={mailbox.id} title={mailbox.address} className="truncate py-0.5">{mailbox.address}</div>)}</div>}
      {mode === "DELETE_WITH_MAILBOXES" && preview && <label className="mt-4 block text-sm font-medium text-red-800">输入 {preview.confirmation} 确认<input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="form-control mt-1.5 h-11 w-full px-3" /></label>}
      {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={onClose} className="btn-secondary focus-ring h-10 px-4 text-sm">取消</button><button disabled={busy || !preview || (mode === "MOVE_TO_TARGET" && !targetGroupId) || (mode === "DELETE_WITH_MAILBOXES" && confirmation !== preview?.confirmation)} className={`${mode === "DELETE_WITH_MAILBOXES" ? "btn-danger" : "btn-primary"} focus-ring h-10 px-4 text-sm`}>{busy ? "正在处理..." : mode === "DELETE_WITH_MAILBOXES" ? "永久删除" : "迁移并删除分组"}</button></div>
    </form>
  </Modal>;
}

function DeleteChoice({ checked, onChange, title, detail, danger }: { checked: boolean; onChange: () => void; title: string; detail: string; danger?: boolean }) {
  return <label className={`flex cursor-pointer gap-3 rounded-md border p-3 ${checked ? danger ? "border-red-300 bg-red-50" : "border-blue-300 bg-blue-50" : "border-slate-200"}`}><input type="radio" checked={checked} onChange={onChange} className="mt-1 h-4 w-4 shrink-0 accent-blue-700" /><span className="min-w-0"><span className={`block text-sm font-medium ${danger ? "text-red-800" : "text-slate-900"}`}>{title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{detail}</span></span></label>;
}
