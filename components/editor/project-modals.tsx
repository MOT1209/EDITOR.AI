// مودالات المشروع والتصدير — استُخرجت من Editor.tsx لتقليل حجم الملف.
import { FolderOpen, Plus, Film, Trash2, Download, CheckCircle2 } from "lucide-react";
import type { ProjectState } from "@/lib/types";
import { formatTime, formatBytes } from "@/lib/project";
import { ModalShell, EmptyState } from "./ui";

export function ProjectsModal({
  projects,
  onClose,
  onLoad,
  onDelete,
  onNew,
}: {
  projects: ProjectState[];
  onClose: () => void;
  onLoad: (p: ProjectState) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <ModalShell onClose={onClose} title="مشاريعي" icon={FolderOpen} width="max-w-3xl">
      <div className="space-y-3">
        <button className="btn-primary w-full" onClick={onNew}>
          <Plus className="h-4 w-4" />
          مشروع جديد
        </button>
        {projects.length === 0 ? (
          <EmptyState text="لا توجد مشاريع محفوظة بعد." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-line bg-bg-soft overflow-hidden hover:border-brand/40 transition"
              >
                <div
                  className="h-24 bg-gradient-to-br from-brand/30 to-brand-accent/30 grid place-items-center"
                  style={
                    p.thumbnail
                      ? { backgroundImage: `url(${p.thumbnail})`, backgroundSize: "cover" }
                      : undefined
                  }
                >
                  {!p.thumbnail && <Film className="h-8 w-8 text-white/60" />}
                </div>
                <div className="p-2.5">
                  <div className="text-sm font-semibold truncate">{p.name}</div>
                  <div className="text-[10px] text-ink-mute mt-0.5">
                    {p.aspect} • {p.resolution} • {formatTime(p.duration)}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      onClick={() => onLoad(p)}
                      className="btn-primary text-[10px] px-2 py-1"
                    >
                      فتح
                    </button>
                    <button
                      onClick={() => onDelete(p.id)}
                      className="btn-ghost text-[10px] px-2 py-1 text-rose-300"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

export function ExportModal({
  project,
  progress,
  onCancel,
}: {
  project: ProjectState;
  progress: number;
  onCancel: () => void;
}) {
  return (
    <ModalShell onClose={onCancel} title="جاري التصدير" icon={Download} width="max-w-md">
      <div className="space-y-3">
        <div className="text-xs text-ink-soft">
          تصدير &quot;{project.name}&quot; بصيغة {project.format.toUpperCase()} • {project.resolution} •{" "}
          {project.fps}fps
        </div>
        <div className="h-2 bg-bg-soft rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand to-brand-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-[10px] text-ink-mute">{Math.round(progress)}%</div>
        <button className="btn-ghost w-full" onClick={onCancel}>
          إلغاء
        </button>
      </div>
    </ModalShell>
  );
}

export function ExportResultModal({
  result,
  onClose,
  onDownload,
}: {
  result: { name: string; size: number };
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <ModalShell onClose={onClose} title="تم التصدير" icon={CheckCircle2} width="max-w-md">
      <div className="space-y-3 text-center">
        <div className="h-16 w-16 rounded-full bg-emerald-500/20 grid place-items-center mx-auto">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <div>
          <div className="text-sm font-semibold">{result.name}</div>
          <div className="text-[11px] text-ink-soft mt-1">{formatBytes(result.size)}</div>
        </div>
        <div className="text-[11px] text-ink-soft">
          تم حفظ نسخة المشروع محلياً • يمكنك أيضاً تصدير ملف JSON لإعادة فتحه لاحقاً
        </div>
        <div className="flex gap-2">
          <button className="btn-outline flex-1" onClick={onClose}>
            إغلاق
          </button>
          <button className="btn-primary flex-1" onClick={onDownload}>
            <Download className="h-4 w-4" />
            تنزيل
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
