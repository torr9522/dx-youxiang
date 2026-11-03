import { useMemo, useState } from "react";
import { api, type Domain, type Mailbox } from "../api";
import { Modal } from "./Modal";

export function CreateMailboxDialog({ domains, onClose, onCreated }: { domains: Domain[]; onClose: () => void; onCreated: (mailbox: Pick<Mailbox, "id" | "address" | "external_login">) => void }) {
  const defaultDomain = domains.find((domain) => domain.is_default) ?? domains.find((domain) => domain.enabled) ?? domains[0];
  const [localPart, setLocalPart] = useState("");
  const [domainId, setDomainId] = useState(defaultDomain?.id ?? 0);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedDomain = domains.find((domain) => domain.id === domainId);
  const address = useMemo(() => localPart && selectedDomain ? `${localPart}@${selectedDomain.name}`.toLowerCase() : "", [localPart, selectedDomain]);

  return <Modal title="创建邮箱" onClose={onClose}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setError("");
      try {
        const mailbox = await api<Pick<Mailbox, "id" | "address" | "external_login">>("/api/mailboxes", {
          method: "POST",
          body: JSON.stringify({ localPart, domainId, note }),
        });
        onCreated(mailbox);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      <label className="block text-sm font-medium text-slate-700">邮箱前缀
        <input autoFocus required value={localPart} onChange={(event) => setLocalPart(event.target.value)} placeholder="例如 155" className="form-control mt-1.5 h-11 w-full px-3" />
      </label>
      <label className="mt-4 block text-sm font-medium text-slate-700">邮箱域名
        <select required value={domainId} onChange={(event) => setDomainId(Number(event.target.value))} className="form-control mt-1.5 h-11 w-full px-3">
          <option value={0}>选择域名</option>
          {domains.filter((domain) => domain.enabled).map((domain) => <option value={domain.id} key={domain.id}>@{domain.name}</option>)}
        </select>
      </label>
      <div className="mt-4 min-h-16 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="text-xs text-slate-500">完整地址</div>
        <div title={address || undefined} className="mt-1 truncate text-sm font-medium text-slate-900">{address || "输入前缀后自动生成"}</div>
      </div>
      <label className="mt-4 block text-sm font-medium text-slate-700">备注
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="form-control mt-1.5 min-h-20 w-full resize-y p-3" />
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary focus-ring h-10 px-4 text-sm">取消</button>
        <button disabled={busy || !localPart || !domainId} className="btn-primary focus-ring h-10 px-4 text-sm">{busy ? "正在创建..." : "创建邮箱"}</button>
      </div>
    </form>
  </Modal>;
}
