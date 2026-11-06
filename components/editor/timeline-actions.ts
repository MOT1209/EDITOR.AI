// تعديلات التايملاين عند المؤشر (تقسيم/حذف/تكرار) عبر عمليات المحرّك المشتركة — مستخرجة من Editor.tsx بنقل حرفي بلا تغيير سلوك.
// دوال عادية (ليست hooks) تُنشأ في كل render وتغلق على أحدث state عبر ctx، تماماً كما كانت داخل المكوّن.
import {
  deleteClip as deleteClipOp,
  exportClips,
  duplicateClip,
  newId,
  splitClip,
} from "@/lib/engine/timeline";
import type { ProjectState } from "@/lib/types";
import type { NotifyFn } from "./ctx-types";
import type { State, Action } from "./state";

export interface TimelineActionsContext {
  state: State;
  dispatch: React.Dispatch<Action>;
  notify: NotifyFn;
  totalDuration: number;
}

export function createTimelineActions(ctx: TimelineActionsContext) {
  const {
    state,
    dispatch,
    notify,
    totalDuration,
  } = ctx;

  // ---- تعديلات التايملاين عبر عمليات المحرّك المشتركة (نفسها المستخدمة في MCP)
  const ensureBaseClip = (p: ProjectState): ProjectState => {
    if (exportClips(p).length > 0) return p;
    const d = p.duration || totalDuration;
    return {
      ...p,
      clips: [
        ...p.clips,
        {
          id: newId("clip"), assetId: "main", trackId: "t_video", start: 0, duration: d, inPoint: 0, outPoint: d,
          effects: [], volume: 1, speed: 1, zoom: 1, panX: 0, panY: 0, smartZoom: false, colorFilter: "none",
        },
      ],
    };
  };

  const splitAtPlayhead = () => {
    if (!state.videoMeta) return notify("warning", "ارفع فيديو أولاً");
    try {
      const p = ensureBaseClip(state.project);
      const t = state.playhead;
      const clips = exportClips(p);
      const selected = clips.find((c) => c.id === state.selectedClipId && t > c.start && t < c.start + c.duration);
      const target = selected ?? clips.find((c) => t > c.start && t < c.start + c.duration);
      if (!target) return notify("warning", "ضع المؤشر داخل مقطع للتقسيم");
      const r = splitClip(p, target.id, t);
      dispatch({ type: "COMMIT_PROJECT", project: r.project });
      dispatch({ type: "SELECT_CLIP", id: r.newClipId });
    } catch (e) {
      notify("error", "تعذّر التقسيم", e instanceof Error ? e.message : undefined);
    }
  };

  const deleteSelectedClip = () => {
    if (state.selectedAudioId) {
      dispatch({ type: "REMOVE_AUDIO", id: state.selectedAudioId });
      dispatch({ type: "SELECT_AUDIO", id: null });
      return notify("info", "حُذف المقطع الصوتي", "Ctrl+Z للتراجع");
    }
    const ids = state.selectedClipIds.length > 0 ? state.selectedClipIds : state.selectedClipId ? [state.selectedClipId] : [];
    if (ids.length === 0) return notify("warning", "حدّد مقطعاً أولاً");
    try {
      let p = state.project;
      for (const id of ids) p = deleteClipOp(p, id);
      if (exportClips(p).length === 0 && exportClips(state.project).length > 0) {
        return notify("warning", "لا يمكن حذف آخر مقطع", "التايملاين الفارغ يصدّر الفيديو كاملاً");
      }
      dispatch({ type: "COMMIT_PROJECT", project: p });
      dispatch({ type: "SELECT_CLIP", id: null });
      notify("info", ids.length > 1 ? `حُذفت ${ids.length} مقاطع` : "حُذف المقطع", "Ctrl+Z للتراجع");
    } catch (e) {
      notify("error", "تعذّر الحذف", e instanceof Error ? e.message : undefined);
    }
  };

  const duplicateSelected = () => {
    const id = state.selectedClipId;
    if (!id) return notify("warning", "حدّد مقطعاً أولاً");
    try {
      const r = duplicateClip(state.project, id);
      dispatch({ type: "COMMIT_PROJECT", project: r.project });
      dispatch({ type: "SELECT_CLIP", id: r.newClipId });
    } catch (e) {
      notify("error", "تعذّر النسخ", e instanceof Error ? e.message : undefined);
    }
  };

  return {
    ensureBaseClip,
    splitAtPlayhead,
    deleteSelectedClip,
    duplicateSelected,
  };
}
