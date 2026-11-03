import { useEffect, useState } from "react";
import { ArrowRight, Inbox, MailCheck, MailOpen, Plus, RefreshCw } from "lucide-react";
import { api } from "../api";

type Dashboard = { mailboxCount: number; receivingCount: number; unreadCount: number; mailboxes: { id: number; address: string; unreadEmails: number }[] };

export function DashboardPage({ onMailbox, onCreate }: { onMailbox: (id: number) => void; onCreate: () => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const load = () => { setError(""); api<Dashboard>("/api/dashboard").then(setData).catch((e) => setError(e.message)); };
  useEffect(() => { void api<Dashboard>("/api/dashboard").then(setData).catch((e) => setError(e.message)); }, []);
  const stats = [
    { label: "邮箱总数", value: data?.mailboxCount ?? "-", icon: Inbox, color: "text-blue-700 bg-blue-50" },
    { label: "正常接收", value: data?.receivingCount ?? "-", icon: MailCheck, color: "text-sky-700 bg-sky-50" },
    { label: "未读邮件", value: data?.unreadCount ?? "-", icon: MailOpen, color: "text-amber-700 bg-amber-50" },
  ];
  return <div>
    <div className="mb-6 flex items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold text-slate-900">管理总览</h1><p className="mt-1 text-sm text-slate-500">全部邮箱的接收状态与未读统计</p></div><button onClick={onCreate} className="focus-ring flex h-10 items-center gap-2 rounded-md bg-[#2563EB] px-4 text-sm font-medium text-white hover:bg-[#1D4ED8]"><Plus size={17} />创建邮箱</button></div>
    {error && <div className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}<button onClick={load}><RefreshCw size={16} /></button></div>}
    <div className="grid gap-4 sm:grid-cols-3">{stats.map((item) => <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><span className="text-sm text-slate-500">{item.label}</span><span className={`grid h-9 w-9 place-items-center rounded-md ${item.color}`}><item.icon size={18} /></span></div><div className="mt-4 text-3xl font-semibold text-slate-900">{item.value}</div></div>)}</div>
    <section className="mt-7">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold text-slate-900">各邮箱未读</h2><button onClick={load} className="focus-ring grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-200" aria-label="刷新"><RefreshCw size={16} /></button></div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {!data?.mailboxes.length ? <div className="p-10 text-center text-sm text-slate-500">暂无邮箱</div> : data.mailboxes.map((box) => <button key={box.id} onClick={() => onMailbox(box.id)} className="focus-ring flex h-14 w-full items-center border-b border-slate-100 px-4 text-left last:border-0 hover:bg-slate-50"><span className="truncate text-sm font-medium text-slate-800">{box.address}</span><span className={`ml-auto min-w-8 rounded-full px-2 py-1 text-center text-xs ${box.unreadEmails ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>{box.unreadEmails}</span><ArrowRight className="ml-3 text-slate-400" size={16} /></button>)}
      </div>
    </section>
  </div>;
}
