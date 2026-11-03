import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Languages, Trash2 } from "lucide-react";
import { api } from "../api";

type TranslationSettings = {
  protocol: "responses" | "chat_completions" | null;
  baseUrl: string;
  hasApiKey: boolean;
  model: string;
  targetLanguage: string;
  enabled: boolean;
  configured: boolean;
  tested: boolean;
  connectionTestedAt: string | null;
  cacheEntries: number;
};

const emptySettings: TranslationSettings = {
  protocol: null,
  baseUrl: "",
  hasApiKey: false,
  model: "",
  targetLanguage: "zh-CN",
  enabled: false,
  configured: false,
  tested: false,
  connectionTestedAt: null,
  cacheEntries: 0,
};

export function TranslationSettingsPage() {
  const [settings, setSettings] = useState(emptySettings);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test" | "clear-key" | "clear-cache">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<TranslationSettings>("/api/settings/translation").then(setSettings).catch((caught) => setError((caught as Error).message));
  }, []);

  const update = <K extends keyof TranslationSettings>(key: K, value: TranslationSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const save = async (overrides: Partial<TranslationSettings> & { clearApiKey?: boolean } = {}) => {
    setBusy(overrides.clearApiKey ? "clear-key" : "save");
    setError("");
    setMessage("");
    try {
      const next = { ...settings, ...overrides };
      const result = await api<TranslationSettings>("/api/settings/translation", {
        method: "PUT",
        body: JSON.stringify({
          protocol: next.protocol,
          baseUrl: next.baseUrl,
          ...(apiKey && !overrides.clearApiKey ? { apiKey } : {}),
          clearApiKey: Boolean(overrides.clearApiKey),
          model: next.model,
          targetLanguage: next.targetLanguage,
          enabled: overrides.clearApiKey ? false : next.enabled,
        }),
      });
      setSettings(result);
      setApiKey("");
      setMessage(overrides.clearApiKey ? "API Key 已清除，翻译已关闭。" : "配置已保存。配置变更后需要重新测试连接。");
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(""); }
  };

  const testConnection = async () => {
    setBusy("test"); setError(""); setMessage("");
    try {
      const result = await api<TranslationSettings>("/api/settings/translation/test", { method: "POST", body: "{}" });
      setSettings(result);
      setMessage("连接成功。现在可以启用邮件翻译。");
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(""); }
  };

  const clearCache = async () => {
    if (!window.confirm("确认清除全部邮件译文缓存？原始邮件不会受影响。")) return;
    setBusy("clear-cache"); setError(""); setMessage("");
    try {
      await api("/api/settings/translation/cache", { method: "DELETE" });
      setSettings((current) => ({ ...current, cacheEntries: 0 }));
      setMessage("译文缓存已清除。");
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(""); }
  };

  return <div>
    <div className="mb-5">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900"><Languages size={22} />邮件翻译</h1>
      <p className="mt-1 text-sm text-slate-500">配置管理员选择的 OpenAI 兼容翻译服务</p>
    </div>

    <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
      只有用户点击翻译后，邮件正文中的可翻译文字才会发送给管理员配置的第三方 API。第三方服务的数据保留策略由其运营方决定。
    </div>
    {error && <div role="alert" className="mb-4 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {message && <div role="status" className="mb-4 flex items-center gap-2 rounded-md border border-green-100 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 size={16} />{message}</div>}

    <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="surface-panel p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block text-sm text-slate-700">API 协议
          <select aria-label="API 协议" value={settings.protocol ?? ""} onChange={(event) => update("protocol", event.target.value ? event.target.value as TranslationSettings["protocol"] : null)} className="form-control mt-1.5 h-11 w-full px-3">
            <option value="">请选择 API 协议</option>
            <option value="responses">Responses</option>
            <option value="chat_completions">Chat Completions</option>
          </select>
        </label>
        <label className="block text-sm text-slate-700">模型名称
          <input aria-label="模型名称" value={settings.model} onChange={(event) => update("model", event.target.value)} placeholder="由服务提供商给出的模型名称" className="form-control mt-1.5 h-11 w-full px-3" />
        </label>
        <label className="block text-sm text-slate-700 lg:col-span-2">API Base URL
          <input aria-label="API Base URL" value={settings.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" inputMode="url" className="form-control mt-1.5 h-11 w-full px-3" />
        </label>
        <label className="block text-sm text-slate-700">API Key
          <span className="relative mt-1.5 block">
            <input aria-label="API Key" type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.hasApiKey ? "已保存；留空表示不修改" : "输入 API Key"} autoComplete="new-password" className="form-control h-11 w-full px-3 pr-11" />
            <button type="button" title={showKey ? "隐藏 API Key" : "显示 API Key"} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowKey((shown) => !shown)} className="focus-ring absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100">{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </span>
          <span className="mt-1 block text-xs text-slate-500">{settings.hasApiKey ? "服务器已加密保存 API Key，浏览器无法读取明文。" : "尚未保存 API Key。"}</span>
        </label>
        <label className="block text-sm text-slate-700">目标语言
          <select aria-label="目标语言" value={settings.targetLanguage} onChange={(event) => update("targetLanguage", event.target.value)} className="form-control mt-1.5 h-11 w-full px-3">
            <option value="zh-CN">简体中文</option><option value="zh-TW">繁体中文</option><option value="en">英语</option><option value="ja">日语</option><option value="ko">韩语</option><option value="es">西班牙语</option><option value="fr">法语</option><option value="de">德语</option>
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={settings.enabled} disabled={!settings.tested || !settings.configured} onChange={(event) => update("enabled", event.target.checked)} className="h-4 w-4 accent-blue-600" />启用邮件翻译</label>
        <span className="text-xs text-slate-500">{settings.tested ? `连接已验证${settings.connectionTestedAt ? ` · ${new Date(settings.connectionTestedAt + "Z").toLocaleString("zh-CN")}` : ""}` : "保存完整配置并测试连接后才能启用"}</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button disabled={Boolean(busy)} className="btn-primary focus-ring h-10 px-4 text-sm">{busy === "save" ? "保存中..." : "保存配置"}</button>
        <button type="button" disabled={Boolean(busy) || !settings.configured} onClick={() => void testConnection()} className="btn-secondary focus-ring h-10 px-4 text-sm">{busy === "test" ? "测试中..." : "测试连接"}</button>
        {settings.hasApiKey && <button type="button" disabled={Boolean(busy)} onClick={() => void save({ clearApiKey: true })} className="btn-secondary focus-ring h-10 px-4 text-sm text-red-700">清除 API Key</button>}
      </div>
    </form>

    <section className="mt-4 surface-panel flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-slate-900">翻译缓存</h2><p className="mt-1 text-sm text-slate-500">当前 {settings.cacheEntries} 条。模型、协议、目标语言或正文变化时不会复用旧译文。</p></div>
      <button type="button" disabled={Boolean(busy) || settings.cacheEntries === 0} onClick={() => void clearCache()} className="btn-secondary focus-ring h-10 gap-2 px-3 text-sm"><Trash2 size={16} />{busy === "clear-cache" ? "清除中..." : "清除缓存"}</button>
    </section>
  </div>;
}
