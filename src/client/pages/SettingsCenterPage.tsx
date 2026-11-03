import { ArrowLeft, FileClock, Globe2, Languages, Settings } from "lucide-react";
import { AuditPage } from "./AuditPage";
import { SettingsPage as DomainSettingsPage } from "./SettingsPage";

export type SettingsSection = "home" | "domains" | "audit" | "translation";

type Props = {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
};

const entries = [
  { section: "domains" as const, title: "域名设置", description: "管理收件域名、DNS 验证和默认域名。", icon: Globe2 },
  { section: "audit" as const, title: "审计记录", description: "查看最近的管理员关键操作记录。", icon: FileClock },
  { section: "translation" as const, title: "邮件翻译", description: "配置第三方翻译服务和译文缓存。", icon: Languages },
];

export function SettingsCenterPage({ section, onSection }: Props) {
  if (section === "home") {
    return <div>
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900"><Settings size={22} />设置</h1>
        <p className="mt-1 text-sm text-slate-500">管理域名、审计记录和邮件显示功能</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => <button key={entry.section} type="button" onClick={() => onSection(entry.section)} className="focus-ring surface-panel flex min-h-28 items-start gap-3 p-4 text-left hover:border-blue-200 hover:bg-blue-50/40">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-700"><entry.icon size={20} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">{entry.title}</span>
            <span className="mt-1 block text-sm leading-6 text-slate-500">{entry.description}</span>
          </span>
        </button>)}
      </div>
    </div>;
  }

  return <div>
    <button type="button" onClick={() => onSection("home")} className="focus-ring mb-4 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-blue-700"><ArrowLeft size={16} />返回设置</button>
    {section === "domains" && <DomainSettingsPage />}
    {section === "audit" && <AuditPage />}
    {section === "translation" && <TranslationSettingsPlaceholder />}
  </div>;
}

function TranslationSettingsPlaceholder() {
  return <div>
    <div className="mb-5">
      <h1 className="text-2xl font-semibold text-slate-900">邮件翻译</h1>
      <p className="mt-1 text-sm text-slate-500">翻译服务未配置时不会发送邮件内容，也不会产生第三方 API 费用。</p>
    </div>
    <div className="surface-panel p-5 text-sm leading-6 text-slate-600">请配置翻译服务后再启用邮件翻译。</div>
  </div>;
}
