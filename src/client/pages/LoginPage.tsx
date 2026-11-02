import { useState } from "react";
import { Inbox, LockKeyhole } from "lucide-react";
import { api } from "../api";

export function LoginPage({ onLogin }: { onLogin: (csrf: string) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="grid min-h-screen place-items-center bg-[#edf1ed] p-5">
    <main className="w-full max-w-sm">
      <div className="mb-7 flex items-center justify-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-md bg-[#14532d] text-white"><Inbox size={23} /></div>
        <div><h1 className="text-xl font-semibold text-stone-900">Private Mail Hub</h1><p className="text-sm text-stone-500">私人邮箱管理中心</p></div>
      </div>
      <form className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError("");
        try { const data = await api<{ csrfToken: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); onLogin(data.csrfToken); }
        catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <div className="mb-5 flex items-center gap-2 text-sm font-medium text-stone-800"><LockKeyhole size={17} />管理员登录</div>
        <label className="mb-4 block text-sm text-stone-700">用户名<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="focus-ring mt-1.5 h-11 w-full rounded-md border border-stone-300 px-3 outline-none" /></label>
        <label className="block text-sm text-stone-700">密码<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="focus-ring mt-1.5 h-11 w-full rounded-md border border-stone-300 px-3 outline-none" /></label>
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="focus-ring mt-5 h-11 w-full rounded-md bg-[#166534] text-sm font-medium text-white hover:bg-[#14532d] disabled:opacity-60">{busy ? "正在验证..." : "登录"}</button>
      </form>
    </main>
  </div>;
}
