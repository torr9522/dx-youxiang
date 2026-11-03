import { useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, type Domain } from "../api";
import { Modal } from "./Modal";

const BULK_LIMIT = 100;
type Mode = "range" | "manual";
type Row = { id: number; value: string };
type BulkResult = {
  total: number;
  succeeded: number;
  skippedExisting: number;
  duplicates: number;
  failed: number;
  results: { address: string; status: string; reason?: string }[];
};

export function BulkCreateMailboxDialog({ domains, onClose, onChanged }: { domains: Domain[]; onClose: () => void; onChanged: () => void }) {
  const defaultDomain = domains.find((domain) => domain.enabled && domain.is_default);
  const [mode, setMode] = useState<Mode>("range");
  const [start, setStart] = useState("1");
  const [end, setEnd] = useState("10");
  const nextId = useRef(2);
  const [rows, setRows] = useState<Row[]>([{ id: 1, value: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);

  const range = useMemo(() => {
    if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) return { values: [] as string[], error: "起始编号和结束编号必须是非负整数" };
    const first = Number(start); const last = Number(end);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return { values: [] as string[], error: "编号超出有效范围" };
    if (first > last) return { values: [] as string[], error: "起始编号必须小于或等于结束编号" };
    const count = last - first + 1;
    if (count > BULK_LIMIT) return { values: [] as string[], error: `每次最多创建 ${BULK_LIMIT} 个邮箱，请缩小范围` };
    return { values: Array.from({ length: count }, (_, index) => String(first + index)), error: "" };
  }, [start, end]);
  const manualValues = rows.map((row) => row.value.trim()).filter(Boolean);
  const values = mode === "range" ? range.values : manualValues;
  const validationError = !defaultDomain ? "默认邮箱域名未配置或未启用" : mode === "range" ? range.error : manualValues.length === 0 ? "至少输入一个邮箱前缀" : manualValues.length > BULK_LIMIT ? `每次最多创建 ${BULK_LIMIT} 个邮箱` : "";
  const preview = values.slice(0, 8).map((value) => `${value.toLowerCase()}@${defaultDomain?.name ?? ""}`);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (validationError) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await api<BulkResult>("/api/mailboxes/bulk", { method: "POST", body: JSON.stringify({ localParts: values }) });
      setResult(response);
      if (response.succeeded > 0) onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally { setBusy(false); }
  };

  return <Modal title="批量创建邮箱" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="grid grid-cols-2 rounded-md bg-slate-100 p-1" aria-label="创建模式">
        <button type="button" onClick={() => setMode("range")} className={`focus-ring h-9 rounded text-sm font-medium ${mode === "range" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>范围创建</button>
        <button type="button" onClick={() => setMode("manual")} className={`focus-ring h-9 rounded text-sm font-medium ${mode === "manual" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>逐行自定义</button>
      </div>

      {mode === "range" ? <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-slate-700">起始编号<input inputMode="numeric" value={start} onChange={(event) => setStart(event.target.value)} className="form-control mt-1.5 h-11 w-full px-3" /></label>
        <label className="text-sm font-medium text-slate-700">结束编号<input inputMode="numeric" value={end} onChange={(event) => setEnd(event.target.value)} className="form-control mt-1.5 h-11 w-full px-3" /></label>
      </div> : <div className="mt-4 space-y-2">
        {rows.map((row, index) => <div key={row.id} className="bulk-manual-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:flex">
          <label className="sr-only" htmlFor={`bulk-local-${row.id}`}>邮箱前缀 {index + 1}</label>
          <input id={`bulk-local-${row.id}`} value={row.value} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))} placeholder={`前缀 ${index + 1}`} className="form-control h-11 min-w-0 flex-1 px-3" />
          <span title={defaultDomain?.name} className="min-w-0 truncate text-xs text-slate-500 sm:max-w-[40%] sm:text-sm">@{defaultDomain?.name ?? "未配置"}</span>
          <button type="button" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} aria-label={`删除第 ${index + 1} 行`} className="focus-ring col-start-2 row-span-2 row-start-1 grid h-10 w-10 shrink-0 place-items-center rounded-md text-red-600 hover:bg-red-50 disabled:opacity-30 sm:col-auto sm:row-auto"><Trash2 size={17} /></button>
        </div>)}
        <button type="button" disabled={rows.length >= BULK_LIMIT} onClick={() => setRows((current) => [...current, { id: nextId.current++, value: "" }])} className="btn-secondary focus-ring h-10 gap-2 px-3 text-sm"><Plus size={16} />添加一行</button>
      </div>}

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="flex justify-between text-slate-600"><span>默认域名 @{defaultDomain?.name ?? "未配置"}</span><span>预计 {values.length} 个 / 上限 {BULK_LIMIT}</span></div>
        {preview.length > 0 && <div className="mt-2 max-h-28 space-y-1 overflow-auto text-xs text-slate-700">{preview.map((address, index) => <div key={`${address}-${index}`}>{address}</div>)}{values.length > preview.length && <div>还有 {values.length - preview.length} 个...</div>}</div>}
      </div>
      {validationError && <p role="alert" className="mt-3 text-sm text-red-700">{validationError}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {result && <div className="mt-4 rounded-md border border-slate-200 p-3 text-sm" role="status">
        <p className="font-medium text-slate-900">处理完成：总计 {result.total} 个</p>
        <p className="mt-1 text-slate-600">成功 {result.succeeded}，已存在跳过 {result.skippedExisting}，本批重复 {result.duplicates}，失败 {result.failed}</p>
        {result.results.some((item) => item.status === "failed") && <div className="mt-2 max-h-24 overflow-auto text-xs text-red-700">{result.results.filter((item) => item.status === "failed").map((item) => <div key={item.address}>{item.address || "空前缀"}：{item.reason}</div>)}</div>}
      </div>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary focus-ring h-10 px-4 text-sm">关闭</button>
        <button disabled={busy || !!validationError} className="btn-primary focus-ring h-10 px-4 text-sm">{busy ? "正在创建..." : "开始创建"}</button>
      </div>
    </form>
  </Modal>;
}
