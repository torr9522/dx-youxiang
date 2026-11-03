import { useState } from "react";
import { api, type Mailbox } from "../api";
import { Modal } from "./Modal";

type BulkDeleteResult = {
  total: number;
  deleted: number;
  failed: number;
  results: { id: number; address?: string; status: "deleted" | "failed"; reason?: string }[];
};

export function BulkDeleteMailboxDialog({ mailboxes, onClose, onChanged }: { mailboxes: Mailbox[]; onClose: () => void; onChanged: (failedIds: number[]) => void }) {
  const [targetIds, setTargetIds] = useState(mailboxes.map((mailbox) => mailbox.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BulkDeleteResult | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await api<BulkDeleteResult>("/api/mailboxes/bulk-delete", { method: "POST", body: JSON.stringify({ ids: targetIds }) });
      const failedIds = response.results.filter((item) => item.status === "failed").map((item) => item.id);
      setResult(response); setTargetIds(failedIds); onChanged(failedIds);
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  };

  return <Modal title="批量删除邮箱" onClose={onClose}>
    {!result ? <>
      <p className="text-sm text-slate-800">确定删除选中的 <strong>{mailboxes.length}</strong> 个邮箱？</p>
      <div className="mt-3 max-h-32 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">{mailboxes.map((mailbox) => <div title={mailbox.address} className="truncate" key={mailbox.id}>{mailbox.address}</div>)}</div>
      <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">删除后，这些邮箱及其全部邮件、附件和文件夹将被永久删除，无法恢复。</p>
    </> : <div role="status" className="rounded-md border border-slate-200 p-3 text-sm">
      <p className="font-medium text-slate-900">删除完成：总计 {result.total} 个</p>
      <p className="mt-1 text-slate-600">成功删除 {result.deleted}，失败 {result.failed}</p>
      {result.failed > 0 && <div className="mt-3 max-h-32 overflow-auto text-xs text-red-700">{result.results.filter((item) => item.status === "failed").map((item) => <div key={item.id}>{item.address ?? `ID ${item.id}`}：{item.reason}</div>)}</div>}
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <form onSubmit={submit} className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onClose} className="btn-secondary focus-ring h-10 px-4 text-sm">{result ? "关闭" : "取消"}</button>
      {(!result || targetIds.length > 0) && <button disabled={busy || targetIds.length === 0} className="btn-danger focus-ring h-10 px-4 text-sm">{busy ? "正在删除..." : result ? "重试失败项" : "确定删除"}</button>}
    </form>
  </Modal>;
}
