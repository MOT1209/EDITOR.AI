"use client";

// مكتبة الوسائط: استيراد (فيديو/صوت/صورة) إلى الخادم بتحقق ffprobe، معاينة، بحث وتصفية، مجلدات،
// بيانات وصفية، وتحذير وسائط مفقودة. كل زر يستدعي عملية حقيقية؛ لا شيء زخرفي.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, AudioLines, Film, Folder, FolderPlus, Image as ImageIcon, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react";
import type { Action, State } from "./state";
import type { AudioClip, MediaAsset, ProjectState, VideoClip } from "@/lib/types";
import { SectionTitle, EmptyState } from "./ui";
import { apiFetch } from "@/lib/api-config";
import { clipDuration, moveClipToTrack, newId } from "@/lib/engine/timeline";

type Notify = (type: "info" | "success" | "warning" | "error", title: string, message?: string) => void;
type Filter = "all" | "video" | "audio" | "image";

const fileUrl = (ref: string) => `/api/assets/file?ref=${encodeURIComponent(ref)}`;
const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:` : "") + `${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

const kindOf = (a: MediaAsset): "video" | "audio" | "image" => (a.type === "video" ? "video" : a.type === "image" ? "image" : "audio");

export function MediaLibrary({
  state,
  dispatch,
  notify,
  prepare,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  notify: Notify;
  /** يضمن وجود مقطع أساسي للفيديو المرفوع قبل الإضافة (حتى لا يُستبعد صامتاً من التايملاين). */
  prepare: (p: ProjectState) => ProjectState;
}) {
  const project = state.project;
  const assets = useMemo(() => (project.assets ?? []).filter((a) => typeof a.meta?.ref === "string"), [project.assets]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [folder, setFolder] = useState<string>("*");
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [uploading, setUploading] = useState<string[]>([]);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [targetTrack, setTargetTrack] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<ProjectState>(project);
  projectRef.current = project;

  const folders = useMemo(() => {
    const set = new Set<string>(extraFolders);
    for (const a of assets) if (a.meta?.folder) set.add(String(a.meta.folder));
    return [...set].sort();
  }, [assets, extraFolders]);

  // فحص الوسائط المفقودة على الخادم (يعمل عند تغيّر القائمة).
  const refsKey = assets.map((a) => a.meta!.ref).join("|");
  useEffect(() => {
    if (assets.length === 0) return setMissing(new Set());
    let cancelled = false;
    apiFetch("/api/assets/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refs: assets.map((a) => a.meta!.ref) }) })
      .then((r) => r.json())
      .then((d: { missing?: string[] }) => !cancelled && setMissing(new Set(d.missing ?? [])))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey]);

  const commitAssets = useCallback(
    (fn: (list: MediaAsset[]) => MediaAsset[]) => {
      dispatch({ type: "PATCH_PROJECT", patch: { assets: fn(project.assets ?? []) } });
    },
    [dispatch, project.assets]
  );

  const importFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      setUploading((u) => [...u, file.name]);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await apiFetch("/api/assets/upload", { method: "POST", body: form });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.ref) throw new Error(d.error || `فشل الرفع (${res.status})`);
        const asset: MediaAsset = {
          id: newId("asset"),
          type: d.kind === "audio" ? "audio" : d.kind === "image" ? "image" : "video",
          name: String(d.name || file.name).slice(0, 200),
          url: "",
          duration: Math.min(d.durationSeconds || 0, 6 * 3600),
          meta: {
            ref: d.ref,
            size: d.size,
            hasAudio: d.hasAudio ? 1 : 0,
            ...(d.video ? { width: d.video.width, height: d.video.height, fps: Math.round(d.video.fps * 100) / 100 } : {}),
            ...(folder !== "*" ? { folder } : {}),
          },
        };
        dispatch({ type: "PATCH_PROJECT", patch: { assets: [...((projectRef.current.assets) ?? []), asset] } });
        projectRef.current = { ...projectRef.current, assets: [...(projectRef.current.assets ?? []), asset] };
        notify("success", "استُورد الوسيط", asset.name);
      } catch (e) {
        notify("error", `تعذّر استيراد ${file.name}`, e instanceof Error ? e.message : undefined);
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
  };
  const addToTimeline = (a: MediaAsset) => {
    try {
      const kind = kindOf(a);
      let p = prepare(projectRef.current);
      if (kind === "audio") {
        const track = p.tracks.find((t) => t.id === targetTrack && t.kind === "audio") ?? p.tracks.find((t) => t.kind === "audio" && !t.locked);
        if (!track) return notify("warning", "لا يوجد مسار صوت غير مقفل");
        const clip: AudioClip = {
          id: newId("aclip"),
          name: a.name,
          trackId: track.id,
          start: Math.round(state.playhead * (p.fps || 30)) / (p.fps || 30),
          duration: a.duration || 5,
          url: fileUrl(String(a.meta!.ref)),
          volume: 1,
          kind: "music",
          ref: String(a.meta!.ref),
        };
        dispatch({ type: "COMMIT_PROJECT", project: { ...p, audioClips: [...p.audioClips, clip] } });
        dispatch({ type: "SELECT_AUDIO", id: clip.id });
        return notify("success", "أُضيف الصوت إلى التايملاين", "غيّر نوعه (موسيقى/تعليق) من الخصائص");
      }
      const selTrackId = state.selectedClipId ? p.clips.find((c) => c.id === state.selectedClipId)?.trackId : undefined;
      const track =
        p.tracks.find((t) => t.id === targetTrack && t.kind === "video") ??
        p.tracks.find((t) => t.id === selTrackId && t.kind === "video") ??
        p.tracks.find((t) => t.kind === "video" && !t.locked);
      if (!track) return notify("warning", "لا يوجد مسار فيديو غير مقفل");
      const dur = kind === "image" ? 5 : a.duration || 5;
      const clip: VideoClip = {
        id: newId("clip"),
        assetId: a.id,
        trackId: track.id,
        start: 0,
        duration: dur,
        inPoint: 0,
        outPoint: dur,
        effects: [],
        volume: 1,
        speed: 1,
        zoom: 1,
        panX: 0,
        panY: 0,
        smartZoom: false,
        colorFilter: "none",
        ...(kind === "image" ? { kind: "image" as const } : {}),
      };
      const onTrack = p.clips.filter((c) => c.trackId === track.id && c.kind !== "image");
      const end = onTrack.reduce((m, c) => Math.max(m, c.start + clipDuration(c)), 0);
      // مسار مغناطيسي: في النهاية؛ مسار حرّ: عند المؤشر إن أمكن وإلا بعد آخر مقطع.
      const startAt = track.magnetic === false ? state.playhead : end;
      p = { ...p, clips: [...p.clips, { ...clip, start: end }] };
      try {
        p = moveClipToTrack(p, clip.id, track.id, startAt);
      } catch {
        p = moveClipToTrack(p, clip.id, track.id, end);
      }
      dispatch({ type: "COMMIT_PROJECT", project: p });
      dispatch({ type: "SELECT_CLIP", id: clip.id });
      notify("success", "أُضيف إلى التايملاين", `${track.label}`);
    } catch (e) {
      notify("error", "تعذّرت الإضافة", e instanceof Error ? e.message : undefined);
    }
  };

  const usage = (a: MediaAsset) => project.clips.filter((c) => c.assetId === a.id).length + project.audioClips.filter((c) => c.ref === a.meta?.ref).length;

  const removeAsset = (a: MediaAsset) => {
    const n = usage(a);
    if (n > 0) return notify("warning", "الوسيط مستخدم على التايملاين", `${n} مقطع يشير إليه — احذفها أولاً`);
    commitAssets((l) => l.filter((x) => x.id !== a.id));
    if (previewId === a.id) setPreviewId(null);
  };

  const q = query.trim().toLowerCase();
  const visible = assets.filter((a) => (filter === "all" || kindOf(a) === filter) && (folder === "*" || (a.meta?.folder ?? "") === (folder === "" ? "" : folder)) && (!q || a.name.toLowerCase().includes(q)));
  const preview = assets.find((a) => a.id === previewId);
  const missingUsed = assets.filter((a) => missing.has(String(a.meta!.ref)) && usage(a) > 0);

  return (
    <div className="space-y-3">
      <SectionTitle icon={Film} title="مكتبة الوسائط" />

      {missingUsed.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>
            وسائط مفقودة على الخادم ومستخدمة في المشروع: <b>{missingUsed.map((a) => a.name).join("، ")}</b>. لن يعمل التصدير حتى تُستورد من جديد (أو تُحذف مقاطعها).
          </div>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
        }}
        className={`rounded-md border border-dashed p-3 text-center text-[11px] ${dragOver ? "border-brand bg-brand/10" : "border-line"}`}
      >
        <button className="btn-outline w-full" onClick={() => inputRef.current?.click()} disabled={uploading.length > 0}>
          {uploading.length ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading.length ? `جارٍ رفع ${uploading.length}…` : "استيراد وسائط (فيديو / صوت / صورة)"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/png,image/jpeg,image/webp,image/gif,.mkv,.m4v,.opus,.flac"
          className="sr-only"
          aria-label="اختيار ملفات للاستيراد"
          onChange={(e) => {
            if (e.target.files?.length) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="mt-1.5 text-[10px] text-ink-mute">أو اسحب الملفات وأفلتها هنا. تُفحص بـ ffprobe قبل القبول.</div>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-ink-soft">
        المسار الهدف عند الإضافة
        <select value={targetTrack} onChange={(e) => setTargetTrack(e.target.value)} className="flex-1 bg-bg-soft border border-line rounded px-1 py-1 text-[10px]" aria-label="المسار الهدف">
          <option value="">تلقائي (المحدّد أو الأول)</option>
          {project.tracks.filter((t) => t.kind === "video" || t.kind === "audio").map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} {t.kind === "video" ? (t.magnetic === false ? "(طبقة حرّة)" : "(أساسي)") : "(صوت)"}
            </option>
          ))}
        </select>
      </label>

      <div className="relative">
        <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-mute" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث في الوسائط…"
          aria-label="بحث في الوسائط"
          className="w-full bg-bg-soft border border-line rounded-md pr-7 pl-2 py-1.5 text-xs"
        />
      </div>

      <div className="flex gap-1" role="group" aria-label="تصفية حسب النوع">
        {(
          [
            ["all", "الكل"],
            ["video", "فيديو"],
            ["audio", "صوت"],
            ["image", "صور"],
          ] as [Filter, string][]
        ).map(([id, label]) => (
          <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={`flex-1 text-[10px] py-1 rounded-md border ${filter === id ? "bg-brand/15 border-brand/40 text-brand-glow" : "border-line text-ink-soft"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="المجلدات">
        {[
          { id: "*", label: "كل الوسائط" },
          { id: "", label: "بلا مجلد" },
          ...folders.map((f) => ({ id: f, label: f })),
        ].map((f) => (
          <button key={f.id || "(none)"} aria-pressed={folder === f.id} onClick={() => setFolder(f.id)} className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${folder === f.id ? "bg-brand/15 border-brand/40 text-brand-glow" : "border-line text-ink-soft"}`}>
            <Folder className="h-2.5 w-2.5" />
            {f.label}
          </button>
        ))}
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newFolder.trim().slice(0, 40);
            if (!name) return;
            setExtraFolders((l) => (l.includes(name) ? l : [...l, name]));
            setFolder(name);
            setNewFolder("");
          }}
        >
          <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="مجلد جديد" aria-label="اسم مجلد جديد" className="w-20 bg-bg-soft border border-line rounded px-1.5 py-0.5 text-[10px]" />
          <button type="submit" className="text-ink-soft hover:text-ink p-0.5" title="إنشاء مجلد" aria-label="إنشاء مجلد">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>

      {preview && (
        <div className="rounded-md border border-line bg-black/40 p-1.5">
          <div className="flex items-center justify-between mb-1 text-[10px] text-ink-soft">
            <span className="truncate">{preview.name}</span>
            <button onClick={() => setPreviewId(null)} aria-label="إغلاق المعاينة" className="text-ink-mute hover:text-ink">
              <X className="h-3 w-3" />
            </button>
          </div>
          {kindOf(preview) === "video" && <video key={preview.id} src={fileUrl(String(preview.meta!.ref))} controls className="w-full max-h-40 rounded" />}
          {kindOf(preview) === "audio" && <audio key={preview.id} src={fileUrl(String(preview.meta!.ref))} controls className="w-full" />}
          {kindOf(preview) === "image" && (
            <img src={fileUrl(String(preview.meta!.ref))} alt={preview.name} className="w-full max-h-40 object-contain rounded" />
          )}
        </div>
      )}

      {assets.length === 0 ? (
        <EmptyState text="لا وسائط بعد. استورد ملفات لتظهر هنا وتُستخدم كمصادر متعددة في التصدير." />
      ) : visible.length === 0 ? (
        <EmptyState text="لا نتائج مطابقة للبحث/التصفية." />
      ) : (
        <ul className="space-y-1.5">
          {visible.map((a) => {
            const k = kindOf(a);
            const isMissing = missing.has(String(a.meta!.ref));
            const Icon = k === "video" ? Film : k === "audio" ? AudioLines : ImageIcon;
            return (
              <li key={a.id} className={`p-2 rounded-md text-[11px] border ${isMissing ? "border-rose-500/50 bg-rose-500/5" : previewId === a.id ? "bg-brand/10 border-brand/30" : "bg-bg-soft border-line/50"}`}>
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
                  <button className="truncate flex-1 text-right hover:text-brand-glow" onClick={() => setPreviewId(a.id)} title="معاينة" disabled={isMissing}>
                    {a.name}
                  </button>
                  {isMissing && (
                    <span className="flex items-center gap-0.5 text-rose-300 text-[10px]" title="الملف غير موجود على الخادم">
                      <AlertTriangle className="h-3 w-3" />
                      مفقود
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[10px] text-ink-mute flex flex-wrap gap-x-2">
                  {k !== "image" && <span>{fmtDur(a.duration)}</span>}
                  {a.meta?.width ? <span>{a.meta.width}×{a.meta.height}</span> : null}
                  {a.meta?.fps ? <span>{a.meta.fps}fps</span> : null}
                  {k === "video" && <span>{a.meta?.hasAudio ? "بصوت" : "بلا صوت"}</span>}
                  {a.meta?.size ? <span>{fmtSize(Number(a.meta.size))}</span> : null}
                  <span>استخدام: {usage(a)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <button className="btn-outline px-2 py-0.5 text-[10px]" onClick={() => addToTimeline(a)} disabled={isMissing} title="إضافة إلى التايملاين">
                    <Plus className="h-3 w-3" />
                    للتايملاين
                  </button>
                  <select
                    aria-label={`مجلد ${a.name}`}
                    value={String(a.meta?.folder ?? "")}
                    onChange={(e) =>
                      commitAssets((l) =>
                        l.map((x) => {
                          if (x.id !== a.id) return x;
                          const meta = { ...(x.meta ?? {}) } as Record<string, string | number>;
                          if (e.target.value) meta.folder = e.target.value;
                          else delete meta.folder;
                          return { ...x, meta };
                        })
                      )
                    }
                    className="bg-bg border border-line rounded px-1 py-0.5 text-[10px] max-w-[90px]"
                  >
                    <option value="">بلا مجلد</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <div className="flex-1" />
                  <button className="text-rose-400 hover:text-rose-300 p-0.5" onClick={() => removeAsset(a)} title="حذف من المكتبة (غير المستخدم فقط)" aria-label={`حذف ${a.name}`}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
