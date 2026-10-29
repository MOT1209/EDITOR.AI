// ====================================================================
// خطط المونتاج: جسر بين مسار وكلاء Python (EDL) ومشروع التايملاين.
//
// create → مسار Python بوضع --plan-only على وسيط المشروع (تحليل حقيقي + مخرج +
//          ناقد + صوت) — الخطة تُحفظ ولا تغيّر المشروع.
// review → فحص بنيوي (نظير validate_plan) + ملخص التغييرات المتوقعة.
// apply  → (بعد موافقة) تحويل مقاطع الإبقاء إلى مقاطع تايملاين، والترجمات
//          والنصوص إلى عناصرها — عملية واحدة قابلة للتراجع.
// ====================================================================
import { promises as fsp, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { PlanOverlay } from "@/lib/agents/types";
import type { ProjectState, SubtitleCue, TextOverlay, VideoClip } from "@/lib/types";
import { EngineError } from "./errors";
import { runProcess } from "./process";
import { assertId, assetPath, getProject, mutateProject, primaryVideoAsset, projectDir } from "./store";
import { COLOR_FILTER_IDS } from "./project-schema";
import { newId, rippleTrack, timelineDuration } from "./timeline";

/** مقطع EDL كما يسلسله Python (camelCase) — الحقول ذات الافتراضيات مضمونة بعد normalize_plan. */
interface EdlSegment {
  start: number;
  end: number;
  keep: boolean;
  speed: number;
  volume?: number;
  reason?: string;
  colorFilter?: string;
  crop?: { zoom?: number } | null;
}
interface EdlCaption {
  text: string;
  start: number;
  end: number;
}
interface EdlPlan {
  title?: string;
  summary?: string;
  source: { path: string; duration: number; hasAudio?: boolean };
  style?: { colorFilter?: string; captions?: boolean };
  segments: EdlSegment[];
  textOverlays?: PlanOverlay[];
  captions?: EdlCaption[];
}

export interface StoredPlan {
  id: string;
  projectId: string;
  assetId: string;
  createdAt: string;
  request: string;
  /** "local" = بلا مزوّدات مدفوعة (مفاتيح مُزالة من بيئة Python)؛ "providers" = مسموح. */
  mode: "local" | "providers";
  pipelineStatus: string;
  edl: EdlPlan;
  critic: { score: number; verdict: string; suggestions: string[] } | null;
  warnings: string[];
  errors: string[];
  appliedAt?: string;
}

const PAID_KEYS = ["OPENCODE_API_KEY", "HF_TOKEN", "PEXELS_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"];

export function resolvePython(): string {
  if (process.env.MONTAGE_PYTHON) return process.env.MONTAGE_PYTHON;
  const candidates = [
    path.join(process.cwd(), ".venv", "Scripts", "python.exe"),
    path.join(process.cwd(), ".venv", "bin", "python"),
  ];
  return candidates.find((c) => existsSync(c)) || (process.platform === "win32" ? "python" : "python3");
}

function plansDir(projectId: string): string {
  return path.join(projectDir(projectId), "plans");
}

export async function getPlan(projectId: string, planId: string): Promise<StoredPlan> {
  assertId(planId, "معرّف الخطة");
  try {
    return JSON.parse(await fsp.readFile(path.join(plansDir(projectId), `${planId}.json`), "utf-8")) as StoredPlan;
  } catch {
    throw new EngineError("NOT_FOUND", `الخطة غير موجودة: ${planId}`, "أنشئ خطة عبر create_editing_plan.");
  }
}

export async function createPlan(
  projectId: string,
  opts: { request: string; language?: string; aspect?: "9:16" | "16:9" | "1:1"; mood?: string; allowPaidProviders?: boolean; signal?: AbortSignal }
): Promise<StoredPlan> {
  const project = await getProject(projectId);
  const asset = primaryVideoAsset(project);
  const source = assetPath(projectId, asset);
  const id = `plan_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
  const work = path.join(plansDir(projectId), `${id}_work`);
  await fsp.mkdir(work, { recursive: true });
  const jsonOut = path.join(work, "result.json");
  const args = [
    "-m", "src.main", source,
    "--request", opts.request.slice(0, 800),
    "--language", (opts.language ?? "ar").slice(0, 10),
    "--aspect", opts.aspect ?? "9:16",
    "--pipeline-dir", work,
    "--json-out", jsonOut,
    "--plan-only",
    "--no-broll",
  ];
  if (opts.mood) args.push("--mood", opts.mood.slice(0, 20));
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: "utf-8" };
  if (!opts.allowPaidProviders) for (const k of PAID_KEYS) delete env[k];

  const r = await runProcess(resolvePython(), args, {
    timeoutMs: Number(process.env.MONTAGE_PLAN_TIMEOUT_MS || 10 * 60_000),
    signal: opts.signal,
    cwd: process.cwd(),
    env,
    maxStdoutBytes: 512 * 1024,
  });
  if (!existsSync(jsonOut)) {
    const tail = (r.stderr || r.stdout).trim().split("\n").slice(-6).join("\n");
    if (/No module named/.test(tail)) {
      throw new EngineError("DEPENDENCY_MISSING", "حزم Python للمسار غير مثبّتة", "شغّل: pip install -r src/requirements.txt");
    }
    throw new EngineError("EXECUTION_FAILED", `مسار الوكلاء فشل (رمز ${r.code}): ${tail.slice(0, 600)}`);
  }
  const result = JSON.parse(await fsp.readFile(jsonOut, "utf-8"));
  if (!result?.edl?.segments) {
    throw new EngineError("EXECUTION_FAILED", `المسار لم ينتج خطة EDL: ${(result?.errors ?? []).join("؛ ") || "سبب غير معروف"}`);
  }
  const plan: StoredPlan = {
    id,
    projectId,
    assetId: asset.id,
    createdAt: new Date().toISOString(),
    request: opts.request,
    mode: opts.allowPaidProviders ? "providers" : "local",
    pipelineStatus: String(result.status),
    edl: result.edl,
    critic: result.critic
      ? { score: result.critic.score, verdict: result.critic.verdict, suggestions: result.critic.suggestions ?? [] }
      : null,
    warnings: result.warnings ?? [],
    errors: result.errors ?? [],
  };
  await fsp.writeFile(path.join(plansDir(projectId), `${id}.json`), JSON.stringify(plan, null, 2), "utf-8");
  return plan;
}

export interface PlanReview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  expectedChanges: {
    currentDurationSeconds: number;
    plannedDurationSeconds: number;
    currentClips: number;
    plannedClips: number;
    removedSeconds: number;
    captionsToAdd: number;
    textOverlaysToAdd: number;
    colorFilter: string;
    ignoredFeatures: string[];
  };
  critic: StoredPlan["critic"];
  appliedAt?: string;
}

const clampSpeed = (s: number) => Math.min(2, Math.max(0.5, s || 1));

/** فحص بنيوي للخطة مقابل مدة المصدر (نظير validate_plan في Python). */
export async function reviewPlan(projectId: string, planId: string): Promise<PlanReview> {
  const plan = await getPlan(projectId, planId);
  const project = await getProject(projectId);
  const edl = plan.edl;
  const dur = edl.source.duration;
  const errors: string[] = [];
  const warnings = [...plan.errors.map((e) => `المسار: ${e}`)];
  const segs = edl.segments.slice().sort((a, b) => a.start - b.start);
  const keeps = segs.filter((s) => s.keep);
  if (keeps.length === 0) errors.push("الخطة بلا مقاطع إبقاء — الناتج سيكون فارغاً");
  segs.forEach((s) => {
    if (s.end - s.start < 0.05) errors.push(`مقطع صفري/معكوس [${s.start}→${s.end}]`);
    if (s.start < -1e-3 || s.end > dur + 1e-3) errors.push(`مقطع خارج المصدر [${s.start}→${s.end}]`);
  });
  for (let i = 1; i < segs.length; i++) if (segs[i].start < segs[i - 1].end - 1e-6) errors.push(`تداخل مقاطع عند ${segs[i].start}s`);
  if (!project.assets?.some((a) => a.id === plan.assetId)) errors.push("الأصل الذي بُنيت عليه الخطة لم يعد في المشروع");
  if (Math.abs((project.assets?.find((a) => a.id === plan.assetId)?.duration ?? dur) - dur) > 0.1) {
    errors.push("مدة المصدر تغيّرت منذ إنشاء الخطة");
  }
  const ignored: string[] = [];
  if (keeps.some((s) => (s.crop?.zoom ?? 1) > 1)) ignored.push("crop/zoompan (القص الذكي للعمودي) — غير ممثل في نموذج التايملاين، يُتجاهل");
  if (keeps.some((s) => s.speed < 0.5 || s.speed > 2)) ignored.push("سرعات خارج 0.5–2 تُقصّ إلى الحد");
  if (plan.mode === "local") warnings.push("خطة محلية: لا تفريغ صوتي حقيقي بلا مزوّد — الترجمات قد تكون فارغة");
  const planned = keeps.reduce((s, k) => s + (k.end - k.start) / clampSpeed(k.speed), 0);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    expectedChanges: {
      currentDurationSeconds: timelineDuration(project),
      plannedDurationSeconds: Math.round(planned * 1000) / 1000,
      currentClips: project.clips.filter((c) => c.kind !== "image").length,
      plannedClips: keeps.length,
      removedSeconds: Math.round((dur - keeps.reduce((s, k) => s + (k.end - k.start), 0)) * 1000) / 1000,
      captionsToAdd: edl.style?.captions === false ? 0 : (edl.captions ?? []).length,
      textOverlaysToAdd: (edl.textOverlays ?? []).length,
      colorFilter: edl.style?.colorFilter ?? "none",
      ignoredFeatures: ignored,
    },
    critic: plan.critic,
    appliedAt: plan.appliedAt,
  };
}

/** يحوّل زمن مصدر إلى زمن تايملاين وفق مقاطع الإبقاء (null إن وقع في جزء مقطوع). */
export function sourceToTimeline(keeps: { start: number; end: number; speed: number }[], t: number): number | null {
  let acc = 0;
  for (const k of keeps) {
    if (t >= k.start && t <= k.end) return acc + (t - k.start) / k.speed;
    acc += (k.end - k.start) / k.speed;
  }
  return null;
}

export async function applyPlan(projectId: string, planId: string): Promise<{ project: ProjectState; historyId: string; summary: PlanReview["expectedChanges"]; droppedCaptions: number }> {
  const review = await reviewPlan(projectId, planId);
  if (!review.ok) throw new EngineError("CONFLICT", `الخطة لا تجتاز المراجعة: ${review.errors.join("؛ ")}`);
  const plan = await getPlan(projectId, planId);
  if (plan.appliedAt) throw new EngineError("CONFLICT", `طُبّقت هذه الخطة مسبقاً (${plan.appliedAt})`, "استخدم undo_edit للتراجع ثم أنشئ خطة جديدة.");
  let dropped = 0;
  const { project, historyId } = await mutateProject(projectId, "apply_editing_plan", `تطبيق الخطة ${planId}`, (p) => {
    const keeps = plan.edl.segments.filter((s) => s.keep).sort((a, b) => a.start - b.start);
    const norm = keeps.map((k) => ({ start: k.start, end: k.end, speed: clampSpeed(k.speed) }));
    const filter = (f?: string) => ((COLOR_FILTER_IDS as readonly string[]).includes(f ?? "") ? f : "none");
    const styleFilter = filter(plan.edl.style?.colorFilter);
    const newClips: VideoClip[] = keeps.map((k, i) => ({
      id: newId("clip"),
      assetId: plan.assetId,
      trackId: "t_video",
      start: i,
      duration: (k.end - k.start) / norm[i].speed,
      inPoint: k.start,
      outPoint: k.end,
      effects: [],
      volume: Math.min(2, Math.max(0, k.volume ?? 1)),
      speed: norm[i].speed,
      zoom: 1,
      panX: 0,
      panY: 0,
      smartZoom: false,
      colorFilter: k.colorFilter && k.colorFilter !== "none" ? filter(k.colorFilter) : styleFilter,
    }));
    const others = p.clips.filter((c) => c.trackId !== "t_video" || c.kind === "image");
    const clips = rippleTrack([...others, ...newClips], "t_video");

    const toTimeline = (s: number, e: number) => {
      const a = sourceToTimeline(norm, s);
      const b = sourceToTimeline(norm, e);
      return a === null || b === null || b - a < 0.05 ? null : { start: Math.round(a * 1000) / 1000, end: Math.round(b * 1000) / 1000 };
    };
    const captions: SubtitleCue[] = [];
    if (plan.edl.style?.captions !== false) {
      for (const c of plan.edl.captions ?? []) {
        const t = toTimeline(c.start, c.end);
        if (!t) {
          dropped++;
          continue;
        }
        captions.push({ id: newId("sub"), ...t, text: c.text.slice(0, 500), lang: "ar" });
      }
    }
    const overlays: TextOverlay[] = [];
    for (const o of plan.edl.textOverlays ?? []) {
      const t = toTimeline(o.start, o.end);
      if (!t) continue;
      overlays.push({ id: newId("txt"), text: o.text.slice(0, 500), ...t, position: o.position ?? "top", fontFamily: "Tajawal, system-ui, sans-serif", fontSize: 48, color: "#FFFFFF", animation: "fade" });
    }
    return {
      project: { ...p, clips, subtitles: captions.length ? captions : p.subtitles, textOverlays: [...p.textOverlays, ...overlays] },
      result: null,
    };
  });
  plan.appliedAt = new Date().toISOString();
  await fsp.writeFile(path.join(plansDir(projectId), `${planId}.json`), JSON.stringify(plan, null, 2), "utf-8");
  return { project, historyId, summary: review.expectedChanges, droppedCaptions: dropped };
}
