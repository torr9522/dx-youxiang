import { useState } from "react";
import { Inbox, LockKeyhole, ShieldCheck } from "lucide-react";
import { api } from "../api";

export function LoginPage({ onLogin }: { onLogin: (csrf: string) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="grid min-h-screen place-items-center bg-slate-50 p-5">
    <main className="w-full max-w-[380px]">
      <div className="mb-6 flex items-center justify-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-md bg-blue-600 text-white"><Inbox size={22} /></div>
        <div><h1 className="text-xl font-semibold text-slate-950">Dx 邮箱</h1><p className="text-sm text-slate-500">私人收件箱</p></div>
      </div>
      <form className="surface-panel p-6" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError("");
        try { const data = await api<{ csrfToken: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); onLogin(data.csrfToken); }
        catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <div className="mb-5 flex items-center gap-2 text-sm font-medium text-slate-800"><LockKeyhole size={17} />管理员登录</div>
        <label className="mb-4 block text-sm text-slate-700">用户名<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="form-control mt-1.5 h-11 w-full px-3" /></label>
        <label className="block text-sm text-slate-700">密码<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="form-control mt-1.5 h-11 w-full px-3" /></label>
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="btn-primary focus-ring mt-5 h-11 w-full text-sm">{busy ? "正在验证..." : "登录"}</button>
      </form>
      <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400"><ShieldCheck size={13} />安全会话 · 仅接收模式</div>
    </main>
  </div>;
}
