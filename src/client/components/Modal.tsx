import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-lg rounded-lg border border-stone-200 bg-white shadow-xl">
      <div className="flex h-14 items-center justify-between border-b border-stone-200 px-5">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        <button className="focus-ring grid h-9 w-9 place-items-center rounded-md text-stone-500 hover:bg-stone-100" onClick={onClose} aria-label="关闭"><X size={18} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>;
}
