import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/35 p-4 backdrop-blur-[1px]" role="dialog" aria-modal="true">
    <div className={`modal-panel max-h-[calc(100dvh-2rem)] w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg shadow-slate-950/10`}>
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <button className="focus-ring grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={onClose} aria-label="关闭"><X size={18} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>;
}
