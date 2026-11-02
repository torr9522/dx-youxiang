import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FileText, Inbox, Mail, MailOpen, Paperclip, Search, Trash2 } from "lucide-react";
import { api, type Mailbox, type MessageDetail, type MessageSummary } from "../api";

const PAGE_SIZE = 50;
type MessagePage = { list: MessageSummary[]; total: number; position: number };

function messagesPath(mailboxId: number, position: number, query: string, field: string, order: string) {
  const params = new URLSearchParams({ q: query, field, order, position: String(position), limit: String(PAGE_SIZE) });
  return `/api/mailboxes/${mailboxId}/messages?${params}`;
}

export function InboxPage({ mailboxId }: { mailboxId: number }) {
  const [mailbox, setMailbox] = useState<Mailbox | null>(null); const [messages, setMessages] = useState<MessageSummary[]>([]); const [total, setTotal] = useState(0); const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [query, setQuery] = useState(""); const [field, setField] = useState("text"); const [order, setOrder] = useState("desc"); const [position, setPosition] = useState(0); const [error, setError] = useState(""); const [copied, setCopied] = useState(false);
  const listRequest = useRef(0);

  const applyPage = (data: MessagePage) => { setMessages(data.list); setTotal(data.total); setPosition(data.position); setSelected(null); };
  const load = async (nextPosition = 0) => {
    const request = ++listRequest.current;
    setError("");
    try {
      const data = await api<MessagePage>(messagesPath(mailboxId, nextPosition, query, field, order));
      if (request === listRequest.current) applyPage(data);
    } catch (e) { if (request === listRequest.current) setError((e as Error).message); }
  };
  useEffect(() => {
    const request = ++listRequest.current;
    void Promise.all([
      api<Mailbox>(`/api/mailboxes/${mailboxId}`),
      api<MessagePage>(messagesPath(mailboxId, 0, "", "text", "desc")),
    ]).then(([box, data]) => { if (request === listRequest.current) { setMailbox(box); applyPage(data); } })
      .catch((e) => { if (request === listRequest.current) setError((e as Error).message); });
    return () => { listRequest.current += 1; };
  }, [mailboxId]);
  const open = async (message: MessageSummary) => { try { const detail = await api<MessageDetail>(`/api/mailboxes/${mailboxId}/messages/${encodeURIComponent(message.id)}`); setSelected(detail); if (!message.keywords?.["$seen"]) { await api(`/api/mailboxes/${mailboxId}/messages/${encodeURIComponent(message.id)}/read`, { method: "PATCH", body: JSON.stringify({ read: true }) }); const keywords = { ...detail.keywords, "$seen": true }; setSelected((current) => current?.id === message.id ? { ...current, keywords } : current); setMessages((all) => all.map((item) => item.id === message.id ? { ...item, keywords: { ...item.keywords, "$seen": true } } : item)); } } catch (e) { setError((e as Error).message); } };
  const mark = async (read: boolean) => { if (!selected) return; await api(`/api/mailboxes/${mailboxId}/messages/${encodeURIComponent(selected.id)}/read`, { method: "PATCH", body: JSON.stringify({ read }) }); setSelected({ ...selected, keywords: { ...selected.keywords, "$seen": read } }); setMessages((all) => all.map((item) => item.id === selected.id ? { ...item, keywords: { ...item.keywords, "$seen": read } } : item)); };
  const remove = async () => { if (!selected || !confirm("确认永久删除这封邮件？")) return; await api(`/api/mailboxes/${mailboxId}/messages/${encodeURIComponent(selected.id)}`, { method: "DELETE" }); setSelected(null); load(); };
  return <div>
    <div className="mb-5"><h1 className="break-all text-xl font-semibold text-stone-900">{mailbox?.address ?? "收件箱"}</h1><div className="mt-1 flex gap-3 text-xs text-stone-500"><span>{total} 封邮件</span><span>{mailbox?.external_login ? "IMAP 已开启" : "IMAP 已关闭"}</span></div></div>
    {error && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void load(0); }}><div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-3 text-stone-400" size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索当前邮箱" className="focus-ring h-10 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-sm" /></div><select value={field} onChange={(e) => setField(e.target.value)} className="focus-ring h-10 rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="text">全部内容</option><option value="from">发件人</option><option value="subject">主题</option><option value="body">正文</option></select><select value={order} onChange={(e) => setOrder(e.target.value)} className="focus-ring h-10 rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="desc">最新优先</option><option value="asc">最早优先</option></select><button className="h-10 rounded-md bg-[#166534] px-4 text-sm text-white">搜索</button></form>
    <div className="grid min-h-[620px] overflow-hidden rounded-lg border border-stone-200 bg-white lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className={`${selected ? "desktop-only" : ""} border-r border-stone-200`}>
        {!messages.length ? <div className="grid h-72 place-items-center text-sm text-stone-500"><div className="text-center"><Inbox className="mx-auto mb-2 text-stone-300" size={34} />暂无邮件</div></div> : messages.map((message) => <button key={message.id} onClick={() => open(message)} className={`focus-ring block min-h-24 w-full border-b border-stone-100 p-4 text-left hover:bg-stone-50 ${selected?.id === message.id ? "bg-emerald-50/70" : ""}`}><div className="flex items-center gap-2"><span className={`truncate text-sm ${message.keywords?.["$seen"] ? "font-medium text-stone-700" : "font-semibold text-stone-950"}`}>{message.from?.[0]?.name || message.from?.[0]?.email || "未知发件人"}</span><span className="ml-auto shrink-0 text-xs text-stone-400">{formatDate(message.receivedAt)}</span></div><div className={`mt-1 truncate text-sm ${message.keywords?.["$seen"] ? "text-stone-600" : "font-medium text-stone-900"}`}>{message.subject || "（无主题）"}</div><div className="mt-1 flex items-center gap-1.5"><p className="min-w-0 flex-1 truncate text-xs text-stone-400">{message.preview}</p>{message.hasAttachment && <Paperclip className="shrink-0 text-stone-400" size={14} />}</div></button>)}
      </div>
      <article className={`${selected ? "block" : "hidden lg:block"} min-w-0 bg-white`}>
        {!selected ? <div className="grid h-full min-h-96 place-items-center text-sm text-stone-400"><div className="text-center"><MailOpen className="mx-auto mb-2" size={34} />选择一封邮件</div></div> : <>
          <div className="border-b border-stone-200 p-5"><div className="flex items-start gap-3"><button className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-stone-100 lg:hidden" onClick={() => setSelected(null)} aria-label="返回列表"><ChevronDown className="rotate-90" size={18} /></button><div className="min-w-0 flex-1"><h2 className="break-words text-lg font-semibold text-stone-900">{selected.subject || "（无主题）"}</h2><div className="mt-3 text-sm text-stone-700"><span className="font-medium">{selected.from?.[0]?.name || selected.from?.[0]?.email}</span>{selected.from?.[0]?.name && <span className="ml-1 text-stone-400">&lt;{selected.from[0].email}&gt;</span>}</div><div className="mt-1 text-xs text-stone-400">收件：{selected.to?.map((x) => x.email).join(", ")} · {new Date(selected.receivedAt).toLocaleString("zh-CN")}</div></div><div className="flex shrink-0 gap-1"><button title={selected.keywords?.["$seen"] ? "标记未读" : "标记已读"} onClick={() => mark(!selected.keywords?.["$seen"])} className="focus-ring grid h-9 w-9 place-items-center rounded-md text-stone-500 hover:bg-stone-100">{selected.keywords?.["$seen"] ? <Mail size={17} /> : <MailOpen size={17} />}</button><button title="删除邮件" onClick={remove} className="focus-ring grid h-9 w-9 place-items-center rounded-md text-red-600 hover:bg-red-50"><Trash2 size={17} /></button></div></div>
            {selected.verificationCode && <div className="mt-4 flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"><span className="text-xs text-emerald-700">验证码</span><code className="text-lg font-semibold tracking-widest text-emerald-950">{selected.verificationCode}</code><button onClick={async () => { await navigator.clipboard.writeText(selected.verificationCode!); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="ml-auto flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs text-emerald-700 shadow-sm">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制"}</button></div>}
          </div>
          <div className="p-5 lg:p-7">{selected.html ? <div className="mail-html" dangerouslySetInnerHTML={{ __html: selected.html }} /> : <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-stone-700">{selected.plain || "（邮件正文为空）"}</pre>}
            {!!selected.attachments?.length && <div className="mt-8 border-t border-stone-200 pt-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><Paperclip size={16} />附件 ({selected.attachments.length})</h3><div className="grid gap-2 sm:grid-cols-2">{selected.attachments.map((attachment) => <a key={attachment.blobId} href={`/api/mailboxes/${mailboxId}/messages/${encodeURIComponent(selected.id)}/attachments/${encodeURIComponent(attachment.blobId)}`} className="flex items-center gap-3 rounded-md border border-stone-200 p-3 text-sm hover:bg-stone-50"><FileText size={18} className="text-stone-400" /><span className="min-w-0 flex-1 truncate">{attachment.name || "附件"}</span><Download size={16} className="text-stone-400" /></a>)}</div></div>}
          </div>
        </>}
      </article>
    </div>
    {total > PAGE_SIZE && <div className="mt-3 flex items-center justify-end gap-2 text-xs text-stone-500"><span>{position + 1}-{Math.min(position + messages.length, total)} / {total}</span><button type="button" title="上一页" aria-label="上一页" disabled={position === 0} onClick={() => void load(Math.max(0, position - PAGE_SIZE))} className="focus-ring grid h-8 w-8 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"><ChevronLeft size={16} /></button><button type="button" title="下一页" aria-label="下一页" disabled={position + messages.length >= total} onClick={() => void load(position + PAGE_SIZE)} className="focus-ring grid h-8 w-8 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"><ChevronRight size={16} /></button></div>}
  </div>;
}

function formatDate(value: string) { const date = new Date(value); const now = new Date(); return date.toDateString() === now.toDateString() ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }); }
