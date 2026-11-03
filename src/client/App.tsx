import { useEffect, useState } from "react";
import { FileClock, Inbox, LogOut, Menu, Settings, ShieldCheck, Users, X } from "lucide-react";
import { api, setCsrf } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { MailWorkspacePage } from "./pages/MailWorkspacePage";
import { MailboxesPage } from "./pages/MailboxesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuditPage } from "./pages/AuditPage";

type View = "mail" | "mailboxes" | "settings" | "audit";

export function App() {
  const [status, setStatus] = useState<"loading" | "guest" | "ready">("loading");
  const [view, setView] = useState<View>("mail");
  const [targetMailbox, setTargetMailbox] = useState<number | undefined>();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    api<{ csrfToken: string }>("/api/auth/session")
      .then((data) => { setCsrf(data.csrfToken); setStatus("ready"); })
      .catch(() => setStatus("guest"));
  }, []);

  if (status === "loading") return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">正在连接...</div>;
  if (status === "guest") return <LoginPage onLogin={(csrf) => { setCsrf(csrf); setStatus("ready"); }} />;

  const nav = [
    { name: "mail" as const, label: "收件箱", icon: Inbox },
    { name: "mailboxes" as const, label: "邮箱管理", icon: Users },
    { name: "settings" as const, label: "域名", icon: Settings },
    { name: "audit" as const, label: "审计", icon: FileClock },
  ];

  return <div className="min-h-screen bg-slate-50">
    <header className="app-header relative z-40 flex min-h-[57px] items-center border-b border-slate-200 bg-white px-3 sm:px-5">
      <button onClick={() => setView("mail")} className="focus-ring flex shrink-0 items-center gap-2 rounded-md p-1.5 text-left">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-blue-600 text-white"><Inbox size={18} /></span>
        <span className="hidden text-sm font-semibold text-slate-900 sm:block">Dx 邮箱</span>
      </button>
      <span className="ml-2 min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 sm:hidden">{nav.find((item) => item.name === view)?.label}</span>
      <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-1 sm:ml-6 md:flex">
        {nav.map((item) => <button key={item.name} onClick={() => setView(item.name)} title={item.label} className={`focus-ring flex h-9 items-center gap-2 rounded-md px-2.5 text-sm sm:px-3 ${view === item.name ? "bg-blue-50 font-medium text-blue-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}><item.icon size={16} /><span className="hidden md:inline">{item.label}</span></button>)}
      </nav>
      <div className="hidden items-center gap-1.5 text-xs text-slate-400 lg:flex"><ShieldCheck size={14} />仅接收</div>
      <button title="退出登录" aria-label="退出登录" className="focus-ring ml-2 hidden h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 md:grid" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); setCsrf(""); setStatus("guest"); }}><LogOut size={17} /></button>
      <button type="button" aria-label={mobileMenuOpen ? "关闭导航菜单" : "打开导航菜单"} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)} className="focus-ring grid h-10 w-10 place-items-center rounded-md text-slate-600 hover:bg-slate-100 md:hidden">{mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      {mobileMenuOpen && <div className="absolute inset-x-0 top-full border-b border-slate-200 bg-white p-2 shadow-sm md:hidden"><nav aria-label="手机导航" className="grid gap-1">{nav.map((item) => <button key={item.name} onClick={() => { setView(item.name); setMobileMenuOpen(false); }} className={`focus-ring flex min-h-11 items-center gap-3 rounded-md px-3 text-sm ${view === item.name ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}><item.icon size={18} /><span>{item.label}</span></button>)}<button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); setCsrf(""); setStatus("guest"); }} className="focus-ring flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-slate-700 hover:bg-slate-50"><LogOut size={18} />退出登录</button></nav></div>}
    </header>

    {view === "mail" && <MailWorkspacePage key={targetMailbox ?? "default"} initialMailboxId={targetMailbox} onManage={() => setView("mailboxes")} />}
    {view !== "mail" && <main className="page-main mx-auto max-w-[1420px] p-4 sm:p-6 lg:p-8">
      {view === "mailboxes" && <MailboxesPage onMailbox={(id) => { setTargetMailbox(id); setView("mail"); }} />}
      {view === "settings" && <SettingsPage />}
      {view === "audit" && <AuditPage />}
    </main>}
  </div>;
}
