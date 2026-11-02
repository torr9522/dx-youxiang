import { useEffect, useState } from "react";
import { FileClock, Inbox, LogOut, Settings, ShieldCheck, Users } from "lucide-react";
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

  useEffect(() => {
    api<{ csrfToken: string }>("/api/auth/session")
      .then((data) => { setCsrf(data.csrfToken); setStatus("ready"); })
      .catch(() => setStatus("guest"));
  }, []);

  if (status === "loading") return <div className="grid min-h-screen place-items-center bg-stone-50 text-sm text-stone-500">正在连接...</div>;
  if (status === "guest") return <LoginPage onLogin={(csrf) => { setCsrf(csrf); setStatus("ready"); }} />;

  const nav = [
    { name: "mail" as const, label: "收件箱", icon: Inbox },
    { name: "mailboxes" as const, label: "邮箱管理", icon: Users },
    { name: "settings" as const, label: "域名", icon: Settings },
    { name: "audit" as const, label: "审计", icon: FileClock },
  ];

  return <div className="min-h-screen bg-[#f7f8f7]">
    <header className="flex h-[57px] items-center border-b border-stone-200 bg-white px-3 sm:px-5">
      <button onClick={() => setView("mail")} className="focus-ring flex shrink-0 items-center gap-2 rounded-md p-1.5 text-left">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-emerald-700 text-white"><Inbox size={18} /></span>
        <span className="hidden text-sm font-semibold text-stone-900 sm:block">Dx 邮箱</span>
      </button>
      <nav className="ml-2 flex min-w-0 flex-1 items-center gap-1 sm:ml-6">
        {nav.map((item) => <button key={item.name} onClick={() => setView(item.name)} title={item.label} className={`focus-ring flex h-9 items-center gap-2 rounded-md px-2.5 text-sm sm:px-3 ${view === item.name ? "bg-emerald-50 font-medium text-emerald-800" : "text-stone-500 hover:bg-stone-100 hover:text-stone-800"}`}><item.icon size={16} /><span className="hidden md:inline">{item.label}</span></button>)}
      </nav>
      <div className="hidden items-center gap-1.5 text-xs text-stone-400 lg:flex"><ShieldCheck size={14} />仅接收</div>
      <button title="退出登录" aria-label="退出登录" className="focus-ring ml-2 grid h-9 w-9 place-items-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-800" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); setCsrf(""); setStatus("guest"); }}><LogOut size={17} /></button>
    </header>

    {view === "mail" && <MailWorkspacePage key={targetMailbox ?? "default"} initialMailboxId={targetMailbox} onManage={() => setView("mailboxes")} />}
    {view !== "mail" && <main className="mx-auto max-w-[1420px] p-4 sm:p-6 lg:p-8">
      {view === "mailboxes" && <MailboxesPage onMailbox={(id) => { setTargetMailbox(id); setView("mail"); }} />}
      {view === "settings" && <SettingsPage />}
      {view === "audit" && <AuditPage />}
    </main>}
  </div>;
}
