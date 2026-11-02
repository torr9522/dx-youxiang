import { useEffect, useState } from "react";
import { Archive, ChevronLeft, FileClock, Inbox, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Users, X } from "lucide-react";
import { api, setCsrf } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MailboxesPage } from "./pages/MailboxesPage";
import { InboxPage } from "./pages/InboxPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuditPage } from "./pages/AuditPage";

type View = { name: "dashboard" | "mailboxes" | "settings" | "audit" } | { name: "inbox"; mailboxId: number };

export function App() {
  const [status, setStatus] = useState<"loading" | "guest" | "ready">("loading");
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [sidebar, setSidebar] = useState(false);

  useEffect(() => {
    api<{ csrfToken: string }>("/api/auth/session").then((data) => { setCsrf(data.csrfToken); setStatus("ready"); }).catch(() => setStatus("guest"));
  }, []);

  if (status === "loading") return <div className="grid min-h-screen place-items-center text-sm text-stone-500">正在连接...</div>;
  if (status === "guest") return <LoginPage onLogin={(csrf) => { setCsrf(csrf); setStatus("ready"); }} />;

  const navigate = (next: View) => { setView(next); setSidebar(false); };
  const nav = [
    { name: "dashboard" as const, label: "总览", icon: LayoutDashboard },
    { name: "mailboxes" as const, label: "邮箱管理", icon: Users },
    { name: "settings" as const, label: "域名设置", icon: Settings },
    { name: "audit" as const, label: "审计记录", icon: FileClock },
  ];

  return <div className="min-h-screen bg-[#f4f6f4]">
    {sidebar && <button className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setSidebar(false)} aria-label="关闭导航" />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[#dbe1dc] bg-[#17241d] text-white transition-transform lg:translate-x-0 ${sidebar ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-[#d6f5df] text-[#14532d]"><Inbox size={20} /></div>
        <div><div className="font-semibold">Dx 邮箱</div><div className="text-xs text-[#aebbb3]">接收管理中心</div></div>
        <button className="ml-auto lg:hidden" onClick={() => setSidebar(false)} aria-label="关闭"><X size={19} /></button>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {nav.map((item) => <button key={item.name} onClick={() => navigate({ name: item.name })} className={`focus-ring flex h-11 w-full items-center gap-3 rounded-md px-3 text-sm ${view.name === item.name ? "bg-white/12 text-white" : "text-[#c2cdc6] hover:bg-white/7 hover:text-white"}`}>
          <item.icon size={18} />{item.label}
        </button>)}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 flex items-center gap-2 px-3 py-2 text-xs text-[#aebbb3]"><ShieldCheck size={15} />仅接收模式</div>
        <button className="focus-ring flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-[#c2cdc6] hover:bg-white/7" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); setStatus("guest"); }}><LogOut size={17} />退出登录</button>
      </div>
    </aside>
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-16 items-center border-b border-[#dbe1dc] bg-white/95 px-4 backdrop-blur lg:px-7">
        <button className="focus-ring mr-3 grid h-9 w-9 place-items-center rounded-md text-stone-600 hover:bg-stone-100 lg:hidden" onClick={() => setSidebar(true)} aria-label="打开导航"><Menu size={20} /></button>
        {view.name === "inbox" && <button className="focus-ring mr-3 grid h-9 w-9 place-items-center rounded-md text-stone-600 hover:bg-stone-100" onClick={() => navigate({ name: "mailboxes" })} aria-label="返回邮箱列表"><ChevronLeft size={20} /></button>}
        <div className="text-sm font-medium text-stone-800">{view.name === "dashboard" ? "管理总览" : view.name === "mailboxes" ? "邮箱管理" : view.name === "inbox" ? "独立收件箱" : view.name === "settings" ? "域名设置" : "审计记录"}</div>
        <div className="ml-auto flex items-center gap-2 text-xs text-stone-500"><Archive size={15} />邮件隔离存储</div>
      </header>
      <main className="mx-auto max-w-[1480px] p-4 lg:p-7">
        {view.name === "dashboard" && <DashboardPage onMailbox={(id) => navigate({ name: "inbox", mailboxId: id })} onCreate={() => navigate({ name: "mailboxes" })} />}
        {view.name === "mailboxes" && <MailboxesPage onMailbox={(id) => navigate({ name: "inbox", mailboxId: id })} />}
        {view.name === "inbox" && <InboxPage key={view.mailboxId} mailboxId={view.mailboxId} />}
        {view.name === "settings" && <SettingsPage />}
        {view.name === "audit" && <AuditPage />}
      </main>
    </div>
  </div>;
}
