"use client";

import { Sparkles, Upload, Download, Save, FolderOpen, FileText, Settings } from "lucide-react";
import type { State, Action } from "../state";

export function Header({
  state,
  dispatch,
  onUploadClick,
  onExport,
  onSave,
  onProjects,
  onImport,
  onShortcuts,
  onApiSettings,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onUploadClick: () => void;
  onExport: () => void;
  onSave: () => void;
  onProjects: () => void;
  onImport: () => void;
  onShortcuts: () => void;
  onApiSettings: () => void;
}) {
  return (
    <header className="h-11 bg-[#0a0a12] border-b border-[#1e1e2e] flex items-center px-3 gap-2 shrink-0 overflow-x-auto">
      <div className="flex items-center gap-1.5">
        <div className="h-7 w-7 rounded-md bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm font-bold text-zinc-200 tracking-tight">MontageAI</span>
        <span className="text-[9px] text-zinc-400 mr-1">استوديو محلي</span>
      </div>

      <div className="h-4 w-px bg-[#1e1e2e] mx-1.5" />

      <div className="flex items-center gap-0.5">
        <button className="text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a28] px-2 py-1 rounded transition-colors" onClick={onProjects}>
          <FolderOpen className="h-3.5 w-3.5 inline-block ml-1" />
          المشاريع
        </button>
        <button className="text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a28] px-2 py-1 rounded transition-colors" onClick={onImport}>
          <FileText className="h-3.5 w-3.5 inline-block ml-1" />
          استيراد
        </button>
        <button className="text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a28] px-2 py-1 rounded transition-colors" onClick={onSave}>
          <Save className="h-3.5 w-3.5 inline-block ml-1" />
          حفظ
        </button>
      </div>

      <div className="h-4 w-px bg-[#1e1e2e] mx-1.5" />

      <input
        type="text"
        value={state.project.name}
        onChange={(e) =>
          dispatch({ type: "PATCH_PROJECT", patch: { name: e.target.value } })
        }
        className="bg-[#12121e] border border-[#1e1e2e] rounded px-2 py-1 text-[11px] text-zinc-300 w-36 focus:outline-none focus:border-blue-600/50 transition-colors"
        placeholder="اسم المشروع"
      />

      <div className="flex-1" />

      <button className="text-[11px] text-zinc-400 hover:text-zinc-300 px-1.5 py-1 transition-colors" onClick={onApiSettings} title="إعدادات API">
        <Settings className="h-3.5 w-3.5 inline-block" />
      </button>

      <button className="text-[11px] text-zinc-400 hover:text-zinc-300 px-1.5 py-1" onClick={onShortcuts} title="اختصارات">
        <kbd className="text-[9px] text-zinc-300 bg-[#1a1a28] border border-[#1e1e2e] px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
      </button>

      <button className="text-[11px] text-zinc-400 hover:text-zinc-200 bg-[#1a1a28] hover:bg-[#22223a] border border-[#1e1e2e] px-3 py-1.5 rounded transition-colors flex items-center gap-1" onClick={onUploadClick}>
        <Upload className="h-3.5 w-3.5" />
        رفع
      </button>
      <button className="text-[11px] text-white bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded transition-colors flex items-center gap-1 shadow-sm" onClick={onExport}>
        <Download className="h-3.5 w-3.5" />
        تصدير
      </button>
    </header>
  );
}
