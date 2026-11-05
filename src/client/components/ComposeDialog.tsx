import { useMemo, useRef, useState } from "react";
import { Bold, Italic, Link, Paperclip, Send, Underline, X } from "lucide-react";
import { api, type Mailbox, type MessageDetail } from "../api";
import { Modal } from "./Modal";

type ComposeMode = "compose" | "reply" | "replyAll" | "forward";

function prefixed(subject: string | undefined, prefix: "Re" | "Fwd") {
  const value = subject?.trim() ?? "";
  return new RegExp(`^${prefix}:`, "i").test(value) ? value : `${prefix}: ${value}`.trim();
}

function addresses(values: string) {
  return [...new Set(values.split(/[,;\n]/).map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export function ComposeDialog({ mailbox, mode, message, onClose, onDone }: {
  mailbox: Mailbox;
  mode: ComposeMode;
  message?: MessageDetail | null;
  onClose: () => void;
  onDone: (kind: "queued" | "draft") => void;
}) {
  const initial = useMemo(() => {
    if (!message || mode === "compose") return { to: "", cc: "", subject: "", body: "" };
    const sender = message.from?.map((item) => item.email) ?? [];
    const own = mailbox.address.toLowerCase();
    const replyAll = mode === "replyAll";
    const to = mode === "forward" ? [] : [...sender, ...(replyAll ? (message.to ?? []).map((item) => item.email) : [])].filter((item) => item.toLowerCase() !== own);
    const cc = replyAll ? (message.cc ?? []).map((item) => item.email).filter((item) => item.toLowerCase() !== own) : [];
    const heading = `\n\n----- ${mode === "forward" ? "转发邮件" : "原始邮件"} -----\n发件人: ${message.from?.[0]?.email ?? ""}\n主题: ${message.subject ?? ""}\n\n`;
    return { to: [...new Set(to)].join(", "), cc: [...new Set(cc)].join(", "), subject: prefixed(message.subject, mode === "forward" ? "Fwd" : "Re"), body: heading + (message.plain ?? "") };
  }, [mailbox.address, message, mode]);
  const [to, setTo] = useState(initial.to); const [cc, setCc] = useState(initial.cc); const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initial.subject); const [body, setBody] = useState(initial.body); const [format, setFormat] = useState<"plain" | "html">("plain");
  const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const wrap = (start: string, end = start) => {
    const input = bodyRef.current; if (!input) return;
    const before = body.slice(0, input.selectionStart); const selected = body.slice(input.selectionStart, input.selectionEnd); const after = body.slice(input.selectionEnd);
    setBody(`${before}${start}${selected}${end}${after}`);
  };
  const submit = async (kind: "queued" | "draft") => {
    setBusy(true); setError("");
    try {
      const total = files.reduce((sum, file) => sum + file.size, 0);
      if (files.some((file) => file.size > 20 * 1024 * 1024) || total > 25 * 1024 * 1024) throw new Error("附件总大小不能超过 25 MB，单个附件不能超过 20 MB");
      const uploaded = [] as Array<{ blobId: string; type: string; name: string; size: number }>;
      for (const file of files) {
        const result = await api<{ blobId: string; type: string; size: number }>(`/api/mailboxes/${mailbox.id}/uploads?type=${encodeURIComponent(file.type || "application/octet-stream")}`, {
          method: "POST", headers: { "content-type": "application/octet-stream" }, body: file,
        });
        uploaded.push({ blobId: result.blobId, type: result.type || file.type || "application/octet-stream", name: file.name, size: result.size });
      }
      const payload = { to: addresses(to), cc: addresses(cc), bcc: addresses(bcc), subject, text: format === "plain" ? body : body.replace(/<[^>]+>/g, " "), ...(format === "html" ? { html: body } : {}), attachments: uploaded,
        ...(message && mode !== "forward" ? { replyToEmailId: message.id } : {}) };
      await api(`/api/mailboxes/${mailbox.id}/${kind === "draft" ? "drafts" : "submissions"}`, { method: "POST", body: JSON.stringify(payload) });
      onDone(kind);
    } catch (caught) { setError((caught as Error).message); setBusy(false); }
  };

  return <Modal wide title={mode === "compose" ? "写邮件" : mode === "forward" ? "转发邮件" : "回复邮件"} onClose={onClose}>
    <div className="grid gap-3">
      <label className="text-sm text-slate-700">收件人<input value={to} onChange={(event) => setTo(event.target.value)} className="form-control mt-1 h-10 w-full px-3" placeholder="多个地址用逗号分隔" /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-700">抄送<input value={cc} onChange={(event) => setCc(event.target.value)} className="form-control mt-1 h-10 w-full px-3" /></label><label className="text-sm text-slate-700">密送<input value={bcc} onChange={(event) => setBcc(event.target.value)} className="form-control mt-1 h-10 w-full px-3" /></label></div>
      <label className="text-sm text-slate-700">主题<input value={subject} onChange={(event) => setSubject(event.target.value)} className="form-control mt-1 h-10 w-full px-3" /></label>
      <div className="flex items-center justify-between"><div className="flex rounded-md border border-slate-300 p-0.5 text-xs"><button type="button" onClick={() => setFormat("plain")} className={`h-7 rounded px-2 ${format === "plain" ? "bg-blue-600 text-white" : "text-slate-600"}`}>纯文本</button><button type="button" onClick={() => setFormat("html")} className={`h-7 rounded px-2 ${format === "html" ? "bg-blue-600 text-white" : "text-slate-600"}`}>HTML</button></div>{format === "html" && <div className="flex gap-1"><Tool title="粗体" onClick={() => wrap("<strong>", "</strong>")}><Bold size={15} /></Tool><Tool title="斜体" onClick={() => wrap("<em>", "</em>")}><Italic size={15} /></Tool><Tool title="下划线" onClick={() => wrap("<u>", "</u>")}><Underline size={15} /></Tool><Tool title="链接" onClick={() => wrap('<a href="https://">', "</a>")}><Link size={15} /></Tool></div>}</div>
      <textarea ref={bodyRef} value={body} onChange={(event) => setBody(event.target.value)} className="form-control min-h-52 w-full resize-y p-3 font-sans text-sm" placeholder="邮件正文" />
      <div><label className="btn-secondary focus-ring inline-flex h-9 cursor-pointer items-center gap-2 px-3 text-sm"><Paperclip size={16} />添加附件<input type="file" multiple className="sr-only" onChange={(event) => setFiles((current) => [...current, ...Array.from(event.target.files ?? [])])} /></label>{files.length > 0 && <div className="mt-2 grid gap-1">{files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 text-xs text-slate-600"><span className="min-w-0 flex-1 truncate">{file.name}</span><button type="button" title="移除附件" onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}><X size={14} /></button></div>)}</div>}</div>
      {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => void submit("draft")} className="btn-secondary focus-ring h-10 px-4 text-sm">保存草稿</button><button type="button" disabled={busy} onClick={() => void submit("queued")} className="btn-primary focus-ring h-10 gap-2 px-4 text-sm"><Send size={16} />{busy ? "正在提交..." : "发送"}</button></div>
    </div>
  </Modal>;
}

function Tool({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) { return <button type="button" title={title} aria-label={title} onClick={onClick} className="focus-ring grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100">{children}</button>; }
