import { useEffect, useState } from "react";
import { Inbox, LogOut, Menu, Settings, ShieldCheck, Users, X } from "lucide-react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { api, setCsrf, type SessionIdentity } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { MailWorkspacePage } from "./pages/MailWorkspacePage";
import { MailboxesPage } from "./pages/MailboxesPage";
import { SettingsCenterPage, type SettingsSection } from "./pages/SettingsCenterPage";

const safeAppPath = /^\/(?:inbox(?:\/[1-9][0-9]*(?:\/(?:junk(?:\/[^/?#]+)?|[^/?#]+))?)?|mailboxes|settings(?:\/(?:domains|audit|translation))?)\/?$/;

function safeReturnPath(value: string | null) {
  if (!value) return "/inbox";
  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin || !safeAppPath.test(target.pathname)) return "/inbox";
    return `${target.pathname}${target.search}`;
  } catch {
    return "/inbox";
  }
}

function InboxRoute({ isAdmin, folder = "inbox" }: { isAdmin: boolean; folder?: "inbox" | "junk" }) {
  const { mailboxId: mailboxParam, messageId } = useParams();
  const navigate = useNavigate();
  const mailboxId = mailboxParam === undefined ? undefined : /^[1-9][0-9]*$/.test(mailboxParam) && Number.isSafeInteger(Number(mailboxParam)) ? Number(mailboxParam) : null;
  if (mailboxId === null) return <RouteError message="邮箱地址无效" />;
  return <MailWorkspacePage
    isAdmin={isAdmin}
    initialMailboxId={mailboxId}
    initialMessageId={messageId}
    initialFolder={folder}
    onMailboxRoute={(id) => navigate(`/inbox/${id}`)}
    onFolderRoute={(id, nextFolder) => navigate(nextFolder === "junk" ? `/inbox/${id}/junk` : `/inbox/${id}`)}
    onMessageRoute={(id, emailId, currentFolder) => navigate(currentFolder === "junk" ? `/inbox/${id}/junk/${encodeURIComponent(emailId)}` : `/inbox/${id}/${encodeURIComponent(emailId)}`)}
    onMessageListRoute={(id, currentFolder, replace = false) => navigate(currentFolder === "junk" ? `/inbox/${id}/junk` : `/inbox/${id}`, { replace })}
    onInboxRoute={() => navigate("/inbox")}
    onManage={() => navigate("/mailboxes")}
    onSettings={() => navigate("/settings/translation")}
  />;
}

function RouteError({ message = "页面不存在或已被删除" }: { message?: string }) {
  return <main className="grid min-h-[calc(100dvh-57px)] place-items-center bg-slate-50 p-5">
    <div className="surface-panel max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold text-slate-900">无法打开页面</h1>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      <Link to="/inbox" className="btn-primary focus-ring mt-5 inline-flex h-10 items-center px-4 text-sm">返回收件箱</Link>
    </div>
  </main>;
}

function SettingsRoute({ section }: { section: SettingsSection }) {
  const navigate = useNavigate();
  return <main className="page-main mx-auto max-w-[1420px] p-4 sm:p-6 lg:p-8">
    <SettingsCenterPage section={section} onSection={(next) => navigate(next === "home" ? "/settings" : `/settings/${next}`)} />
  </main>;
}

export function App() {
  const [status, setStatus] = useState<"loading" | "guest" | "ready">("loading");
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    api<SessionIdentity>("/api/auth/session")
      .then((data) => {
        if (!active) return;
        setCsrf(data.csrfToken);
        setIdentity(data);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setStatus("guest");
        if (location.pathname !== "/login") {
          const target = safeAppPath.test(location.pathname) ? `${location.pathname}${location.search}` : "/inbox";
          navigate(`/login?next=${encodeURIComponent(target)}`, { replace: true });
        }
      });
    return () => { active = false; };
    // Authentication is checked once for the initial browser location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishLogin = (nextIdentity: SessionIdentity) => {
    setCsrf(nextIdentity.csrfToken);
    setIdentity(nextIdentity);
    setStatus("ready");
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setCsrf("");
    setIdentity(null);
    setStatus("guest");
    setMobileMenuOpen(false);
    navigate("/login", { replace: true });
  };

  if (status === "loading") return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">正在连接...</div>;
  if (status === "guest") return <LoginPage onLogin={finishLogin} />;

  const isAdmin = identity?.role !== "mailbox_user";
  const nav = isAdmin ? [
    { path: "/inbox", label: "收件箱", icon: Inbox },
    { path: "/mailboxes", label: "邮箱管理", icon: Users },
    { path: "/settings", label: "设置", icon: Settings },
  ] : [{ path: "/inbox", label: "收件箱", icon: Inbox }];
  const currentLabel = location.pathname.startsWith("/mailboxes") ? "邮箱管理" : location.pathname.startsWith("/settings") ? "设置" : "收件箱";

  return <div className="min-h-screen bg-slate-50">
    <header className="app-header relative z-40 flex min-h-[57px] items-center border-b border-slate-200 bg-white px-3 sm:px-5">
      <Link to="/inbox" className="focus-ring flex shrink-0 items-center gap-2 rounded-md p-1.5 text-left">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-blue-600 text-white"><Inbox size={18} /></span>
        <span className="hidden text-sm font-semibold text-slate-900 sm:block">Dx 邮箱</span>
      </Link>
      <span className="ml-2 min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 sm:hidden">{currentLabel}</span>
      <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-1 sm:ml-6 md:flex">
        {nav.map((item) => <NavLink key={item.path} to={item.path} title={item.label} className={({ isActive }) => `focus-ring flex h-9 items-center gap-2 rounded-md px-2.5 text-sm sm:px-3 ${isActive ? "bg-blue-50 font-medium text-blue-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}><item.icon size={16} /><span className="hidden md:inline">{item.label}</span></NavLink>)}
      </nav>
      <div className="hidden items-center gap-1.5 text-xs text-slate-400 lg:flex"><ShieldCheck size={14} />{isAdmin ? "管理员" : identity?.username}</div>
      <button title="退出登录" aria-label="退出登录" className="focus-ring ml-2 hidden h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 md:grid" onClick={() => void logout()}><LogOut size={17} /></button>
      <button type="button" aria-label={mobileMenuOpen ? "关闭导航菜单" : "打开导航菜单"} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)} className="focus-ring grid h-10 w-10 place-items-center rounded-md text-slate-600 hover:bg-slate-100 md:hidden">{mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      {mobileMenuOpen && <div className="absolute inset-x-0 top-full border-b border-slate-200 bg-white p-2 shadow-sm md:hidden"><nav aria-label="手机导航" className="grid gap-1">{nav.map((item) => <NavLink key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)} className={({ isActive }) => `focus-ring flex min-h-11 items-center gap-3 rounded-md px-3 text-sm ${isActive ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}><item.icon size={18} /><span>{item.label}</span></NavLink>)}<button onClick={() => void logout()} className="focus-ring flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-slate-700 hover:bg-slate-50"><LogOut size={18} />退出登录</button></nav></div>}
    </header>

    <Routes>
      <Route path="/" element={<Navigate to="/inbox" replace />} />
      <Route path="/login" element={<Navigate to={safeReturnPath(new URLSearchParams(location.search).get("next"))} replace />} />
      <Route path="/inbox/:mailboxId/junk/:messageId?" element={<InboxRoute isAdmin={isAdmin} folder="junk" />} />
      <Route path="/inbox/:mailboxId?/:messageId?" element={<InboxRoute isAdmin={isAdmin} />} />
      <Route path="/mailboxes" element={isAdmin ? <main className="page-main mx-auto max-w-[1420px] p-4 sm:p-6 lg:p-8"><MailboxesPage onMailbox={(id) => navigate(`/inbox/${id}`)} /></main> : <Navigate to="/inbox" replace />} />
      <Route path="/settings" element={isAdmin ? <SettingsRoute section="home" /> : <Navigate to="/inbox" replace />} />
      <Route path="/settings/domains" element={isAdmin ? <SettingsRoute section="domains" /> : <Navigate to="/inbox" replace />} />
      <Route path="/settings/audit" element={isAdmin ? <SettingsRoute section="audit" /> : <Navigate to="/inbox" replace />} />
      <Route path="/settings/translation" element={isAdmin ? <SettingsRoute section="translation" /> : <Navigate to="/inbox" replace />} />
      <Route path="/domains" element={<Navigate to="/settings/domains" replace />} />
      <Route path="/audit" element={<Navigate to="/settings/audit" replace />} />
      <Route path="*" element={<RouteError />} />
    </Routes>
  </div>;
}
