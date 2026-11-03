import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, Download, FileText, Inbox, ListFilter, Mail, MailOpen, MailPlus, Paperclip, RefreshCw, Search, Settings2, Trash2 } from "lucide-react";
import { api, type Domain, type Mailbox, type MessageDetail, type MessageSummary } from "../api";
import { CreateMailboxDialog } from "../components/CreateMailboxDialog";
import { copyText } from "../lib/clipboard";

const PAGE_SIZE = 50;
type MessagePage = { list: MessageSummary[]; total: number; position: number };
type MobileStage = "mailboxes" | "messages" | "detail";
type ReadFilter = "all" | "unread" | "read";

function messagesPath(mailboxId: number, position: number, query: string, field: string, read: ReadFilter, order: string) {
  const params = new URLSearchParams({ q: query, field, read, order, position: String(position), limit: String(PAGE_SIZE) });
  return `/api/mailboxes/${mailboxId}/messages?${params}`;
}

export function MailWorkspacePage({ initialMailboxId, onManage }: { initialMailboxId?: number; onManage: () => void }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [mailboxSearch, setMailboxSearch] = useState("");
  const [selectedMailboxId, setSelectedMailboxId] = useState<number | null>(initialMailboxId ?? null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null);
  const [messageSearch, setMessageSearch] = useState("");
  const [searchField, setSearchField] = useState("text");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [order] = useState("desc");
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(0);
  const [mobileStage, setMobileStage] = useState<MobileStage>(initialMailboxId ? "messages" : "mailboxes");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const requestId = useRef(0);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageScrollTop = useRef(0);

  const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null;

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1600);
  };

  const loadMessages = async (mailboxId: number, nextPosition = 0, query = messageSearch, field = searchField, read = readFilter, nextOrder = order) => {
    const currentRequest = ++requestId.current;
    setError("");
    try {
      const page = await api<MessagePage>(messagesPath(mailboxId, nextPosition, query, field, read, nextOrder));
      if (currentRequest !== requestId.current) return;
      setMessages(page.list);
      setTotal(page.total);
      setPosition(page.position);
      setSelectedMessage(null);
    } catch (caught) {
      if (currentRequest === requestId.current) setError((caught as Error).message);
    }
  };

  const loadMailboxes = async (search = mailboxSearch, preferredId = selectedMailboxId) => {
    const rows = await api<Mailbox[]>(`/api/mailboxes?stats=1&search=${encodeURIComponent(search)}`);
    setMailboxes(rows);
    const next = rows.find((row) => row.id === preferredId) ?? rows[0] ?? null;
    if (next && next.id !== selectedMailboxId) {
      setSelectedMailboxId(next.id);
      await loadMessages(next.id, 0, "", "text", "all", "desc");
    } else if (!next) {
      setSelectedMailboxId(null);
      setMessages([]);
      setTotal(0);
      setSelectedMessage(null);
    }
    return rows;
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      api<Mailbox[]>("/api/mailboxes?stats=1&search="),
      api<Domain[]>("/api/domains"),
    ]).then(async ([rows, domainRows]) => {
      if (!active) return;
      setMailboxes(rows);
      setDomains(domainRows);
      const next = rows.find((row) => row.id === initialMailboxId) ?? rows[0];
      if (next) {
        setSelectedMailboxId(next.id);
        await loadMessages(next.id, 0, "", "text", "all", "desc");
      }
    }).catch((caught) => active && setError((caught as Error).message));
    return () => { active = false; requestId.current += 1; };
    // Initial data is intentionally loaded once; later selection is user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectMailbox = async (mailbox: Mailbox) => {
    setSelectedMailboxId(mailbox.id);
    setMessageSearch("");
    setSearchField("text");
    setReadFilter("all");
    setSelectedMessage(null);
    setMobileStage("messages");
    await loadMessages(mailbox.id, 0, "", "text", "all", "desc");
  };

  const openMessage = async (message: MessageSummary) => {
    if (!selectedMailboxId) return;
    setDetailLoading(true);
    setError("");
    try {
      const detail = await api<MessageDetail>(`/api/mailboxes/${selectedMailboxId}/messages/${encodeURIComponent(message.id)}`);
      setSelectedMessage(detail);
      setMobileStage("detail");
      if (!message.keywords?.["$seen"]) {
        await api(`/api/mailboxes/${selectedMailboxId}/messages/${encodeURIComponent(message.id)}/read`, { method: "PATCH", body: JSON.stringify({ read: true }) });
        const keywords = { ...detail.keywords, "$seen": true };
        setSelectedMessage((current) => current?.id === message.id ? { ...current, keywords } : current);
        setMessages((current) => current.map((item) => item.id === message.id ? { ...item, keywords: { ...item.keywords, "$seen": true } } : item));
        if (readFilter === "unread") {
          setMessages((current) => current.filter((item) => item.id !== message.id));
          setTotal((current) => Math.max(0, current - 1));
        }
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const markRead = async (read: boolean) => {
    if (!selectedMailboxId || !selectedMessage) return;
    await api(`/api/mailboxes/${selectedMailboxId}/messages/${encodeURIComponent(selectedMessage.id)}/read`, { method: "PATCH", body: JSON.stringify({ read }) });
    const keywords = { ...selectedMessage.keywords, "$seen": read };
    setSelectedMessage({ ...selectedMessage, keywords });
    setMessages((current) => current.map((item) => item.id === selectedMessage.id ? { ...item, keywords: { ...item.keywords, "$seen": read } } : item));
    if ((readFilter === "unread" && read) || (readFilter === "read" && !read)) {
      setMessages((current) => current.filter((item) => item.id !== selectedMessage.id));
      setTotal((current) => Math.max(0, current - 1));
    }
  };

  const returnToMessages = () => {
    setMobileStage("messages");
    window.requestAnimationFrame(() => messageListRef.current?.scrollTo({ top: messageScrollTop.current }));
  };

  const deleteMessage = async () => {
    if (!selectedMailboxId || !selectedMessage || !window.confirm("确认永久删除这封邮件？")) return;
    await api(`/api/mailboxes/${selectedMailboxId}/messages/${encodeURIComponent(selectedMessage.id)}`, { method: "DELETE" });
    setSelectedMessage(null);
    setMobileStage("messages");
    await loadMessages(selectedMailboxId, position);
  };

  return <div className="mail-workspace h-[calc(100dvh-57px)] min-h-[520px] bg-white">
    <section aria-label="邮箱列表" className={`${mobileStage === "mailboxes" ? "flex" : "hidden"} min-h-0 flex-col border-r border-slate-200 bg-slate-50 md:flex`}>
      <div className="border-b border-slate-200 px-3 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2 px-1">
          <div><h1 className="text-sm font-semibold text-slate-900">邮箱</h1><p className="mt-0.5 text-xs text-slate-500">{mailboxes.length} 个账户</p></div>
          <button onClick={() => setCreateOpen(true)} title="创建邮箱" aria-label="创建邮箱" className="focus-ring grid h-9 w-9 place-items-center rounded-md bg-blue-600 text-white hover:bg-blue-700"><MailPlus size={17} /></button>
        </div>
        <form className="relative mt-3" onSubmit={(event) => { event.preventDefault(); void loadMailboxes(mailboxSearch); }}>
          <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={16} />
          <input value={mailboxSearch} onChange={(event) => setMailboxSearch(event.target.value)} placeholder="搜索邮箱" aria-label="搜索邮箱" className="form-control h-9 w-full pl-9 pr-9 text-sm" />
          <button title="执行邮箱搜索" aria-label="执行邮箱搜索" className="focus-ring absolute right-1 top-1 grid h-7 w-7 place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-blue-700"><ChevronRight size={15} /></button>
        </form>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {mailboxes.map((mailbox) => <div key={mailbox.id} className={`group mx-2 mb-1 flex min-h-16 items-center rounded-md border ${mailbox.id === selectedMailboxId ? "border-blue-200 bg-blue-50" : "border-transparent hover:border-slate-200 hover:bg-white"}`}>
          <button onClick={() => void selectMailbox(mailbox)} className="focus-ring min-w-0 flex-1 px-3 py-2.5 text-left">
            <span title={mailbox.address} className={`block truncate text-sm leading-5 ${mailbox.id === selectedMailboxId ? "font-semibold text-blue-800" : "font-medium text-slate-800"}`}>{mailbox.address}</span>
            <span className="mt-1 flex items-center gap-2 text-xs text-slate-500"><span>{mailbox.totalEmails ?? "-"} 封</span>{Boolean(mailbox.unreadEmails) && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 font-medium text-white">{mailbox.unreadEmails} 未读</span>}</span>
          </button>
          <button title="复制邮箱地址" aria-label={`复制 ${mailbox.address}`} onClick={async () => { try { await copyText(mailbox.address); showToast("已复制"); } catch (caught) { showToast((caught as Error).message); } }} className="focus-ring mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-blue-700"><Copy size={15} /></button>
        </div>)}
        {!mailboxes.length && <div className="px-5 py-14 text-center text-sm text-slate-500"><Inbox className="mx-auto mb-2 text-slate-300" size={28} />没有匹配的邮箱</div>}
      </div>
      <div className="border-t border-slate-200 p-3"><button onClick={onManage} className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm text-slate-600 hover:bg-white hover:text-blue-700"><Settings2 size={16} />邮箱管理</button></div>
    </section>

    <section aria-label="邮件列表" className={`${mobileStage === "messages" ? "flex" : "hidden"} min-h-0 flex-col border-r border-slate-200 bg-white md:flex`}>
      <div className="border-b border-slate-200 px-4 pb-3 pt-3">
        <div className="flex min-h-8 items-center gap-2">
          <button onClick={() => setMobileStage("mailboxes")} aria-label="返回邮箱列表" className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100 md:hidden"><ArrowLeft size={18} /></button>
          <div className="min-w-0 flex-1"><div title={selectedMailbox?.address} className="truncate text-sm font-semibold text-slate-900">{selectedMailbox?.address ?? "选择邮箱"}</div><div className="mt-0.5 text-xs text-slate-500">{total} 封邮件</div></div>
          {selectedMailboxId && <button title="刷新邮件" aria-label="刷新邮件" onClick={() => void loadMessages(selectedMailboxId, position)} className="focus-ring grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-blue-700"><RefreshCw size={15} /></button>}
        </div>
        <form className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2" onSubmit={(event) => { event.preventDefault(); if (selectedMailboxId) void loadMessages(selectedMailboxId, 0); }}>
          <div className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={16} /><input value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder="搜索当前邮箱" aria-label="搜索当前邮箱" className="form-control h-9 w-full min-w-0 pl-9 pr-3 text-sm" /></div>
          <button aria-label="执行邮件搜索" className="btn-secondary focus-ring grid h-9 w-9 place-items-center p-0"><Search size={15} /></button>
          <div className="col-span-2 flex min-w-0 items-center justify-between gap-2">
            <select title="搜索范围" aria-label="搜索范围" value={searchField} onChange={(event) => setSearchField(event.target.value)} className="form-control h-8 min-w-0 px-2 text-xs"><option value="text">搜索全部</option><option value="from">发件人</option><option value="subject">主题</option><option value="body">正文</option></select>
            <label className="relative min-w-0"><ListFilter className="pointer-events-none absolute left-2.5 top-2 text-slate-400" size={14} /><span className="sr-only">阅读状态</span><select aria-label="阅读状态" value={readFilter} onChange={(event) => { const next = event.target.value as ReadFilter; setReadFilter(next); if (selectedMailboxId) void loadMessages(selectedMailboxId, 0, messageSearch, searchField, next); }} className="form-control h-8 min-w-0 pl-8 pr-2 text-xs"><option value="all">全部</option><option value="unread">未读</option><option value="read">已读</option></select></label>
          </div>
        </form>
      </div>
      {error && <div role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}
      <div ref={messageListRef} onScroll={(event) => { messageScrollTop.current = event.currentTarget.scrollTop; }} className="min-h-0 flex-1 overflow-y-auto">
        {messages.map((message) => {
          const unread = !message.keywords?.["$seen"];
          return <button key={message.id} onClick={() => void openMessage(message)} className={`focus-ring relative block min-h-20 w-full border-b border-slate-100 px-4 py-2.5 text-left md:min-h-24 md:py-3 ${selectedMessage?.id === message.id ? "bg-blue-50" : "hover:bg-slate-50"}`}>
            {unread && <span className="absolute left-1.5 top-4 h-2 w-2 rounded-full bg-blue-600 md:top-5" />}
            <div className="flex min-w-0 items-center gap-2"><span className={`min-w-0 flex-1 truncate text-[13px] md:text-sm ${unread ? "font-semibold text-slate-950" : "font-medium text-slate-700"}`}>{message.from?.[0]?.name || message.from?.[0]?.email || "未知发件人"}</span><time className="min-w-11 shrink-0 text-right text-[11px] text-slate-400 md:text-xs">{formatDate(message.receivedAt)}</time></div>
            <div className={`mt-0.5 line-clamp-2 text-[13px] leading-5 md:mt-1 md:text-sm ${unread ? "font-semibold text-slate-900" : "text-slate-600"}`}>{message.subject || "（无主题）"}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 md:mt-1.5"><p className="min-w-0 flex-1 truncate text-xs leading-4 text-slate-400 md:leading-5">{message.preview}</p>{message.hasAttachment && <Paperclip className="shrink-0 text-slate-400" size={14} />}</div>
          </button>;
        })}
        {!messages.length && <div className="grid h-72 place-items-center text-sm text-slate-500"><div className="text-center"><MailOpen className="mx-auto mb-2 text-slate-300" size={30} />暂无邮件</div></div>}
      </div>
      {total > PAGE_SIZE && <div className="flex h-12 shrink-0 items-center justify-between border-t border-slate-200 px-4 text-xs text-slate-500"><span>{position + 1}-{Math.min(position + messages.length, total)} / {total}</span><div className="flex gap-1"><button type="button" title="上一页" aria-label="上一页" disabled={position === 0} onClick={() => selectedMailboxId && void loadMessages(selectedMailboxId, Math.max(0, position - PAGE_SIZE))} className="focus-ring grid h-8 w-8 place-items-center rounded-md hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={16} /></button><button type="button" title="下一页" aria-label="下一页" disabled={position + messages.length >= total} onClick={() => selectedMailboxId && void loadMessages(selectedMailboxId, position + PAGE_SIZE)} className="focus-ring grid h-8 w-8 place-items-center rounded-md hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={16} /></button></div></div>}
    </section>

    <article aria-label="邮件详情" className={`${mobileStage === "detail" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col bg-white md:flex`}>
      {detailLoading && <div className="grid h-full place-items-center text-sm text-slate-500">正在读取邮件...</div>}
      {!detailLoading && !selectedMessage && <div className="grid h-full place-items-center px-6 text-center text-sm text-slate-400"><div><MailOpen className="mx-auto mb-3 text-slate-300" size={34} />选择一封邮件查看正文</div></div>}
      {!detailLoading && selectedMessage && <>
        <header className="shrink-0 border-b border-slate-200 px-4 py-4 lg:px-6">
          <div className="flex items-start gap-3">
            <button onClick={returnToMessages} aria-label="返回邮件列表" className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100 md:hidden"><ArrowLeft size={18} /></button>
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-base font-semibold leading-6 text-slate-950">{selectedMessage.subject || "（无主题）"}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700"><span className="font-medium">{selectedMessage.from?.[0]?.name || selectedMessage.from?.[0]?.email || "未知发件人"}</span>{selectedMessage.from?.[0]?.name && <span className="mail-address-full text-xs text-slate-400">&lt;{selectedMessage.from[0].email}&gt;</span>}</div>
              <div className="mail-address-full mt-1 text-xs leading-5 text-slate-400">收件人：{selectedMessage.to?.map((recipient) => recipient.email).join(", ") || "-"}</div>
              <time className="mt-1 block text-xs text-slate-400">{new Date(selectedMessage.receivedAt).toLocaleString("zh-CN")}</time>
            </div>
            <div className="flex shrink-0 gap-1">
              <button title={selectedMessage.keywords?.["$seen"] ? "标记未读" : "标记已读"} aria-label={selectedMessage.keywords?.["$seen"] ? "标记未读" : "标记已读"} onClick={() => void markRead(!selectedMessage.keywords?.["$seen"])} className="focus-ring grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-blue-700">{selectedMessage.keywords?.["$seen"] ? <Mail size={17} /> : <MailOpen size={17} />}</button>
              <button title="删除邮件" aria-label="删除邮件" onClick={() => void deleteMessage()} className="focus-ring grid h-9 w-9 place-items-center rounded-md text-red-600 hover:bg-red-50"><Trash2 size={17} /></button>
            </div>
          </div>
          {selectedMessage.verificationCode && <div className="mt-4 flex min-h-14 flex-wrap items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
            <span className="text-xs font-medium text-blue-700">验证码</span><code className="text-xl font-semibold text-blue-950">{selectedMessage.verificationCode}</code>
            <button onClick={async () => { try { await copyText(selectedMessage.verificationCode!); showToast("验证码已复制"); } catch (caught) { setError((caught as Error).message); } }} className="focus-ring ml-auto flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-100"><Copy size={14} />复制</button>
          </div>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-7 lg:py-6">
          {selectedMessage.html ? <div className="mail-html" dangerouslySetInnerHTML={{ __html: selectedMessage.html }} /> : <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-700">{selectedMessage.plain || "（邮件正文为空）"}</pre>}
          {!!selectedMessage.attachments?.length && <section className="mt-8 border-t border-slate-200 pt-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800"><Paperclip size={16} />附件 ({selectedMessage.attachments.length})</h3><div className="grid gap-2 sm:grid-cols-2">{selectedMessage.attachments.map((attachment) => <a key={attachment.blobId} href={`/api/mailboxes/${selectedMailboxId}/messages/${encodeURIComponent(selectedMessage.id)}/attachments/${encodeURIComponent(attachment.blobId)}`} className="focus-ring flex min-h-12 min-w-0 items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:border-blue-200 hover:bg-blue-50"><FileText size={18} className="shrink-0 text-blue-600" /><span className="min-w-0 flex-1"><span className="block truncate">{attachment.name || "附件"}</span>{typeof attachment.size === "number" && <span className="mt-0.5 block text-xs text-slate-400">{formatBytes(attachment.size)}</span>}</span><Download size={16} className="shrink-0 text-slate-400" /></a>)}</div></section>}
        </div>
      </>}
    </article>

    {createOpen && <CreateMailboxDialog domains={domains} onClose={() => setCreateOpen(false)} onCreated={async (created) => {
      setCreateOpen(false);
      setMailboxSearch("");
      setMobileStage("messages");
      await loadMailboxes("", created.id);
      showToast("邮箱已创建");
    }} />}
    {toast && <div role="status" className="mobile-toast fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-white shadow-lg"><Check size={15} />{toast}</div>}
  </div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
