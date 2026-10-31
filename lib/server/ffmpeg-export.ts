import { spawn, spawnSync } from "child_process";
import { promises as fsp, existsSync, readdirSync } from "fs";
import os from "os";
import path from "path";
import type { ProjectAspect, ProjectState, SubtitleCue, TextOverlay, VideoClip } from "@/lib/types";
import { ASSETS_DIR } from "@/lib/server/assets";
import { resolveImageRef } from "@/lib/server/media-ref";
import { childEnv, hardenedSpawn } from "@/lib/engine/hardening";

export const UPLOAD_DIR = path.join(process.cwd(), ".montage_ai", "uploads");
export const EXPORT_DIR = path.join(process.cwd(), ".montage_ai", "exports");

export async function ensureUploadDir() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
}

export async function ensureExportDir() {
  await fsp.mkdir(EXPORT_DIR, { recursive: true });
}

export interface ExportJobStatus {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message?: string;
  /** مشاكل خطة الرندر المهيكلة (عند فشل التحقق) لعرضها بدقة في الواجهة. */
  issues?: RenderIssue[];
  result?: { path: string; size: number; format: string };
}

// Export progress is tracked via a JSON file next to the output, not just the
// in-memory aiJobs map: Next.js dev-mode recompiles route modules independently,
// which can reset module-level state between the POST that starts a job and a
// later GET/download request. A file survives across that, and would also
// survive across separate serverless invocations in production.
function jobStatusPath(id: string): string {
  return path.join(EXPORT_DIR, `${id}.json`);
}

// Progress updates fire frequently and asynchronously (ffmpeg's -progress
// stream), and a later "completed"/"failed" write can race with an in-flight
// progress write to the same file — two concurrent writeFile calls to one path
// can interleave and corrupt the JSON. Serialize per-job writes and write via
// a temp file + rename so a reader never observes a half-written file either.
const writeChains = new Map<string, Promise<void>>();

export async function writeJobStatus(status: ExportJobStatus): Promise<void> {
  const previous = writeChains.get(status.id) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await ensureExportDir();
      const finalPath = jobStatusPath(status.id);
      const tmpPath = `${finalPath}.${process.pid}.tmp`;
      await fsp.writeFile(tmpPath, JSON.stringify(status), "utf-8");
      await fsp.rename(tmpPath, finalPath);
    });
  writeChains.set(status.id, next);
  return next;
}

export async function readJobStatus(id: string): Promise<ExportJobStatus | null> {
  try {
    const raw = await fsp.readFile(jobStatusPath(id), "utf-8");
    return JSON.parse(raw) as ExportJobStatus;
  } catch {
    return null;
  }
}

// Confines a path to one of our managed directories, resolving ".." so a
// client-supplied id/filename can never escape to an arbitrary filesystem path.
export function isPathInside(target: string, dir: string): boolean {
  const resolved = path.resolve(target);
  const resolvedDir = path.resolve(dir);
  return resolved === resolvedDir || resolved.startsWith(resolvedDir + path.sep);
}

let cachedFfmpegPath: string | null = null;

// On Windows, a freshly-installed ffmpeg (e.g. via winget) may not be visible
// on PATH to a process that was already running when it was installed (the
// PATH broadcast doesn't reach it). Fall back to scanning the winget package
// dir and common install locations rather than requiring a full machine restart.
export function resolveFfmpegPath(): string {
  if (cachedFfmpegPath) return cachedFfmpegPath;
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    cachedFfmpegPath = process.env.FFMPEG_PATH;
    return cachedFfmpegPath;
  }
  try {
    const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 3000 });
    if (r.status === 0) {
      cachedFfmpegPath = "ffmpeg";
      return cachedFfmpegPath;
    }
  } catch {
    /* fall through to filesystem search */
  }

  const candidates: string[] = [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  ];
  const wingetPackages = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages"
  );
  try {
    const pkgDirs = readdirSync(wingetPackages).filter((d) => d.startsWith("Gyan.FFmpeg"));
    for (const pkgDir of pkgDirs) {
      const buildRoot = path.join(wingetPackages, pkgDir);
      const builds = readdirSync(buildRoot).filter((d) => d.startsWith("ffmpeg-"));
      for (const build of builds) {
        candidates.push(path.join(buildRoot, build, "bin", "ffmpeg.exe"));
      }
    }
  } catch {
    /* winget packages dir absent — ignore */
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedFfmpegPath = candidate;
      return cachedFfmpegPath;
    }
  }
  cachedFfmpegPath = "ffmpeg";
  return cachedFfmpegPath;
}

export function hasFfmpeg(): boolean {
  try {
    const r = spawnSync(resolveFfmpegPath(), ["-version"], { stdio: "ignore", timeout: 3000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

// كشف تسريع GPU (NVENC) باختبار تشفير حقيقي (القائمة -encoders تذكر المحوّل حتى
// بدون GPU فعلي). يُستخدم للتصدير الأسرع ~300% مع الرجوع تلقائياً إلى libx264.
let nvencCached: boolean | null = null;
export function hasNvenc(): boolean {
  if (nvencCached !== null) return nvencCached;
  try {
    // تشفير إطار أسود صغير واحد إلى null — ينجح فقط مع GPU يعمل فعلاً.
    const r = spawnSync(
      resolveFfmpegPath(),
      [
        "-y", "-f", "lavfi", "-i", "color=black:s=64x64:d=0.2",
        "-c:v", "h264_nvenc", "-preset", "p5", "-cq", "26", "-f", "null", "-",
      ],
      { stdio: "ignore", timeout: 8000 }
    );
    nvencCached = r.status === 0;
  } catch {
    nvencCached = false;
  }
  return nvencCached;
}

export { buildAss } from "@/lib/engine/ass";
export { resolveOutputSize } from "@/lib/engine/render-presets";
import { COLOR_FILTER_FFMPEG, EFFECT_FFMPEG, QUALITY_CRF, FORMAT_CODEC, buildEffectChain, clampSpeed, resolveOutputSize } from "@/lib/engine/render-presets";
import { buildAss } from "@/lib/engine/ass";
import { buildRenderPlan, needsCompositor, type RenderIssue, type SourceMap } from "@/lib/engine/render-plan";
import { compileRenderPlan } from "@/lib/engine/render-compile";

export interface AudioInput {
  /** ملف صوت على الخادم (مسار مطلق مُتحقَّق منه مسبقاً). */
  path: string;
  /** بداية الصوت على التايملاين (ثوانٍ). */
  start: number;
  volume: number;
}

export interface ExportRequest {
  sourcePath: string;
  outputPath: string;
  project: ProjectState;
  onProgress?: (fraction: number) => void;
  /** تثبيت الفيديو (يُطبَّق فلتر deshake في التصدير). */
  videoStabilize?: boolean;
  /** قوة التصحيح اللوني 0..1 (يُطبق كفلتر eq). */
  colorGrading?: number;
  /** إلغاء: يقتل ffmpeg ويحذف المخرَج الجزئي. */
  signal?: AbortSignal;
  /** مهلة قصوى بالميلي ثانية (افتراضي: 20× المدة + 5 دقائق، بحد أقصى ساعتين). */
  timeoutMs?: number;
  /** مسارات صوت إضافية (موسيقى/تعليق) تُمزج فوق صوت المقاطع. */
  audioInputs?: AudioInput[];
  /** نافذة من التايملاين (للمعاينة): يُرندر [start, end) فقط. */
  range?: { start: number; end: number };
  /** أبعاد مخصّصة (للمعاينة منخفضة الدقة) بدل resolution×aspect. */
  size?: [number, number];
  /** preset/crf مخصّص (المعاينة تستخدم ultrafast). */
  encoderOverride?: { preset: string; crf: number };
  /** هل للمصدر مسار صوت؟ (افتراضي true — عند false يُولَّد صمت). */
  sourceHasAudio?: boolean;
  /** مصادر فيديو إضافية (T-02، المسار القديم): مقاطع assetId المطابق تُقصّ منها بدل المصدر الأساسي. */
  extraSources?: ExportSource[];
  /**
   * مصادر متعددة (assetId → ملف) للمركِّب. عند وجودها واحتياج المشروع للمركِّب (مسارات/مصادر
   * متعددة أو خصائص طبقات) يُستخدم render-plan/render-compile بدل المسار القديم.
   */
  sources?: SourceMap;
  /** فرض المركِّب حتى لمشروع بسيط (للاختبار). */
  forceCompositor?: boolean;
  /** اعتبار الصوت المفقود تحذيراً لا خطأ (إقرار المستخدم). */
  allowMissingAudio?: boolean;
}

/** مصدر فيديو إضافي يُضاف كمدخل `-i` ويُربط بمقاطع assetId. */
export interface ExportSource {
  assetId: string;
  path: string;
  hasAudio: boolean;
}

/** خطة رندر غير صالحة: تحمل المشاكل المهيكلة لتُعرض للمستخدم. */
export class RenderPlanError extends Error {
  constructor(public issues: RenderIssue[]) {
    super(`خطة الرندر غير صالحة: ${issues.filter((i) => i.severity === "error").map((i) => i.message).join("؛ ")}`);
    this.name = "RenderPlanError";
  }
}

interface Segment {
  /** معرّف الأصل الذي يُقصّ منه المقطع. */
  assetId?: string;
  /** فهرس مدخل ffmpeg (0 = المصدر الأساسي). يُعيَّن في buildExportPlan. */
  sourceIndex?: number;
  /** تأطير ذكي (T-15): تكبير ≥1 وإزاحة المركز كنسبة من الإطار (-0.5..0.5). يُطبَّق فقط إن smartZoom=true. */
  framing?: { zoom: number; panX: number; panY: number };
  inPoint: number;
  outPoint: number;
  speed: number;
  volume: number;
  colorFilter?: string;
}

export interface ImageOverlay {
  path: string;
  start: number;
  end: number;
}

/** تأطير المقطع من zoom/panX/panY عند smartZoom فقط؛ null إن لا أثر (zoom≈1 وبلا إزاحة). */
export function clipFraming(c: Pick<VideoClip, "smartZoom" | "zoom" | "panX" | "panY">): Segment["framing"] | undefined {
  if (!c.smartZoom) return undefined;
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));
  const zoom = clamp(c.zoom, 1, 4);
  const panX = clamp(c.panX, -0.5, 0.5);
  const panY = clamp(c.panY, -0.5, 0.5);
  if (zoom < 1.001 && Math.abs(panX) < 0.001 && Math.abs(panY) < 0.001) return undefined;
  return { zoom: r3(zoom), panX: r3(panX), panY: r3(panY) };
}

export function buildSegments(project: ProjectState): Segment[] {
  const videoTrackIds = new Set(project.tracks.filter((t) => t.kind === "video").map((t) => t.id));
  const clips = project.clips
    .filter((c) => c.kind !== "image")
    // المقاطع المعلّمة _removed (مثل مقاطع الصمت) تُستثنى من التصدير نهائياً.
    .filter((c) => !(c as VideoClip & { _removed?: boolean })._removed)
    .filter((c) => videoTrackIds.size === 0 || videoTrackIds.has(c.trackId))
    .slice()
    .sort((a, b) => a.start - b.start);

  if (clips.length === 0) {
    // No clips on the timeline yet (the common case right after upload, before
    // any AI tool splits the video) — export the whole source as a single segment.
    return [{ inPoint: 0, outPoint: Math.max(project.duration, 0.1), speed: 1, volume: 1 }];
  }

  return clips.map((c: VideoClip) => ({
    assetId: c.assetId,
    framing: clipFraming(c),
    inPoint: Math.max(0, c.inPoint),
    outPoint: c.outPoint > c.inPoint ? c.outPoint : c.inPoint + c.duration * (c.speed || 1),
    speed: clampSpeed(c.speed),
    volume: typeof c.volume === "number" ? c.volume : 1,
    colorFilter: c.colorFilter,
  }));
}

// Image-kind clips (from the stock-photo library) become full-canvas overlays
// composited on top of the base video for their [start, end] window, rather
// than replacing the base timeline — the natural "B-roll cutaway" behavior.
export function buildImageOverlays(project: ProjectState): ImageOverlay[] {
  return project.clips
    .map((c) => ({ c, p: c.kind === "image" && c.imageUrl ? resolveImageRef(c.imageUrl) : null }))
    .filter((x): x is { c: VideoClip; p: string } => x.p !== null)
    .map(({ c, p }) => ({ path: p, start: c.start, end: c.start + c.duration }));
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * يقصّ خطة التصدير إلى نافذة [a, b) من التايملاين (للمعاينة): المقاطع تُقص
 * بزمن المصدر (مع مراعاة السرعة)، والترجمات/النصوص/الصور تُزاح بمقدار -a.
 */
export function applyRange(
  segments: Segment[],
  range: { start: number; end: number }
): Segment[] {
  const out: Segment[] = [];
  let t = 0;
  for (const seg of segments) {
    const len = (seg.outPoint - seg.inPoint) / seg.speed;
    const a = Math.max(range.start, t);
    const b = Math.min(range.end, t + len);
    if (b - a > 0.01) {
      out.push({
        ...seg,
        inPoint: r3(seg.inPoint + (a - t) * seg.speed),
        outPoint: r3(seg.inPoint + (b - t) * seg.speed),
      });
    }
    t += len;
  }
  return out;
}

function shiftTimed<T extends { start: number; end: number }>(items: T[], range?: { start: number; end: number }): T[] {
  if (!range) return items;
  return items
    .filter((x) => x.end > range.start && x.start < range.end)
    .map((x) => ({ ...x, start: r3(Math.max(0, x.start - range.start)), end: r3(Math.min(range.end, x.end) - range.start) }));
}

const SLIDE_TRANSITION_DURATION = 0.5;

interface FilterOptions {
  segments: Segment[];
  effects: string[];
  imageOverlays: ImageOverlay[];
  /** فهرس أول مدخل صوت إضافي (بعد المصدر والصور). */
  audioInputs: AudioInput[];
  audioInputOffset: number;
  subtitlesFilename: string | null;
  width: number;
  height: number;
  fps: number;
  videoStabilize?: boolean;
  gradingFilter?: string | null;
  sourceHasAudio: boolean;
  /** مصادر إضافية بعد الأساسي (مدخلات 1..k)، ثم صور، ثم صوت. */
  extraSources: ExportSource[];
}

function buildFilterComplex(o: FilterOptions): { filterComplex: string; audioLabel: string } {
  const { segments, effects, imageOverlays, subtitlesFilename, width, height, fps } = o;
  const parts: string[] = [];
  const durations = segments.map((s) => (s.outPoint - s.inPoint) / s.speed);

  segments.forEach((seg, i) => {
    const colorExpr = COLOR_FILTER_FFMPEG[seg.colorFilter || "none"] || "";
    const effectChain = buildEffectChain(effects, durations[i], width, height);
    const fr = seg.framing;
    // قصّ نافذة بحجم الإطار/zoom حول المركز المُزاح (مقيّدة داخل الإطار) قبل التوحيد إلى أبعاد الإخراج.
    const framingCrop = fr
      ? [`crop=w=iw/${fr.zoom}:h=ih/${fr.zoom}:x='min(max(iw/2+(${fr.panX})*iw-iw/${fr.zoom}/2,0),iw-iw/${fr.zoom})':y='min(max(ih/2+(${fr.panY})*ih-ih/${fr.zoom}/2,0),ih-ih/${fr.zoom})'`]
      : [];
    const videoChain = [
      `trim=start=${seg.inPoint}:end=${seg.outPoint}`,
      "setpts=(PTS-STARTPTS)" + (seg.speed !== 1 ? `/${seg.speed}` : ""),
      ...framingCrop,
      // توحيد الأبعاد قبل الدمج: concat/xfade يفشلان مع مقاطع بأبعاد مختلفة (zoompan يغيّرها).
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      "setsar=1",
      ...(o.extraSources.length > 0 ? [`fps=${fps}`] : []),
      ...(colorExpr ? [colorExpr] : []),
      ...effectChain,
    ].join(",");
    const srcIdx = seg.sourceIndex ?? 0;
    parts.push(`[${srcIdx}:v]${videoChain}[v${i}]`);

    const srcHasAudio = srcIdx === 0 ? o.sourceHasAudio : (o.extraSources[srcIdx - 1]?.hasAudio ?? false);
    if (srcHasAudio) {
      const audioChain = [
        `atrim=start=${seg.inPoint}:end=${seg.outPoint}`,
        "asetpts=PTS-STARTPTS",
        ...(seg.speed !== 1 ? [`atempo=${seg.speed}`] : []),
        ...(seg.volume !== 1 ? [`volume=${seg.volume}`] : []),
        "aformat=sample_rates=48000:channel_layouts=stereo",
      ].join(",");
      parts.push(`[${srcIdx}:a]${audioChain}[a${i}]`);
    } else {
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${durations[i].toFixed(3)}[a${i}]`);
    }
  });

  let videoLabel: string;
  let audioLabel: string;

  const useSlideTransition = effects.includes("fx_slide_l") && segments.length > 1;
  if (useSlideTransition) {
    let prevV = "v0";
    let prevA = "a0";
    let cumulative = durations[0];
    for (let i = 1; i < segments.length; i++) {
      const offset = Math.max(0, cumulative - SLIDE_TRANSITION_DURATION);
      const outV = `xv${i}`;
      const outA = `xa${i}`;
      parts.push(
        `[${prevV}][v${i}]xfade=transition=slideleft:duration=${SLIDE_TRANSITION_DURATION}:offset=${offset.toFixed(3)}[${outV}]`
      );
      parts.push(`[${prevA}][a${i}]acrossfade=d=${SLIDE_TRANSITION_DURATION}[${outA}]`);
      cumulative += durations[i] - SLIDE_TRANSITION_DURATION;
      prevV = outV;
      prevA = outA;
    }
    videoLabel = prevV;
    audioLabel = prevA;
  } else {
    const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
    parts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[vcat][acat]`);
    videoLabel = "vcat";
    audioLabel = "acat";
  }

  // Image overlays are extra -i inputs, indexed 1..N (0 is the main source).
  // Each is only visible during its own [start, end] window via `enable`.
  imageOverlays.forEach((ov, i) => {
    const inputIndex = i + 1 + o.extraSources.length;
    const scaledLabel = `imgsc${i}`;
    parts.push(
      `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[${scaledLabel}]`
    );
    const nextLabel = `imgov${i}`;
    parts.push(
      `[${videoLabel}][${scaledLabel}]overlay=0:0:enable='between(t,${ov.start},${ov.end})':eof_action=pass[${nextLabel}]`
    );
    videoLabel = nextLabel;
  });

  const finalOps: string[] = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `fps=${fps}`,
  ];
  if (o.videoStabilize) {
    // deshake: تثبيت خفيف أحادي الممر (بديل عملي لـ vidstab الذي يتطلب ممرين).
    finalOps.push("deshake=rx=16:ry=16:edge=mirror");
  }
  if (o.gradingFilter) {
    finalOps.push(o.gradingFilter);
  }
  if (subtitlesFilename) {
    finalOps.push(`subtitles=${subtitlesFilename}`);
  }
  parts.push(`[${videoLabel}]${finalOps.join(",")}[vout]`);

  // ضبط الصوت التلقائي (تحسين نهائي): إزالة ضوضاء خفيفة (afftdn) ثم
  // تطبيع مستوى الصوت لمعيار السوشال ميديا (-16 LUFS) لضمان وضوح الكلام
  // فوق الموسيقى الخلفية.
  parts.push(`[${audioLabel}]afftdn=nr=12:nf=-35,loudnorm=I=-16:TP=-1.5:LRA=11[aenh]`);
  audioLabel = "aenh";

  // مزج الصوت الإضافي (موسيقى/تعليق): تأخير كل مدخل إلى بدايته على التايملاين.
  if (o.audioInputs.length > 0) {
    const mixLabels: string[] = [];
    o.audioInputs.forEach((a, k) => {
      const idx = o.audioInputOffset + k;
      const chain: string[] = [];
      if (a.start < 0) chain.push(`atrim=start=${(-a.start).toFixed(3)}`, "asetpts=PTS-STARTPTS");
      const delayMs = Math.max(0, Math.round(a.start * 1000));
      if (delayMs > 0) chain.push(`adelay=${delayMs}|${delayMs}`);
      chain.push(`volume=${a.volume}`, "aformat=sample_rates=48000:channel_layouts=stereo");
      parts.push(`[${idx}:a]${chain.join(",")}[mx${k}]`);
      mixLabels.push(`[mx${k}]`);
    });
    parts.push(`[aenh]${mixLabels.join("")}amix=inputs=${mixLabels.length + 1}:duration=first:normalize=0[amix]`);
    audioLabel = "amix";
  }

  return { filterComplex: parts.join(";"), audioLabel };
}

// تحويل مستوى التصحيح اللوني (0..1) إلى فلاتر eq متوافقة مع معاينة CSS
// gain = (colorGrading - 0.5) * 0.4 → brightness(1+gain) saturate(1+gain) contrast(1+gain*0.5)
function colorGradingFilter(colorGrading: number): string | null {
  const g = (colorGrading - 0.5) * 0.4;
  if (Math.abs(g) < 0.01) return null;
  const brightness = +(g / 2).toFixed(3); // eq: -1..1
  const saturation = +(1 + g).toFixed(3);
  const contrast = +(1 + g * 0.5).toFixed(3);
  return `eq=brightness=${brightness}:saturation=${saturation}:contrast=${contrast}`;
}

export interface ExportPlan {
  args: string[];
  /** محتوى ملف ASS (إن وُجدت ترجمات/نصوص) — يُكتب باسم assFilename بجوار cwd. */
  ass: string | null;
  assFilename: string | null;
  totalDuration: number;
  width: number;
  height: number;
  segmentCount: number;
  useNvenc: boolean;
  /** "legacy" = لصق تتابعي من مصدر واحد؛ "compositor" = طبقات متعددة المسارات/المصادر. */
  engine?: "legacy" | "compositor";
  /** مشاكل الخطة (تحذيرات) — الأخطاء ترمي RenderPlanError. */
  issues?: RenderIssue[];
}

function buildCompositorPlan(req: Omit<ExportRequest, "onProgress" | "signal">, allowNvenc: boolean): ExportPlan {
  const { project, range } = req;
  const plan = buildRenderPlan(project, req.sources!, { range, size: req.size, allowMissingAudio: req.allowMissingAudio });
  if (!plan.ok) throw new RenderPlanError(plan.issues);
  const codec = FORMAT_CODEC[project.format] || FORMAT_CODEC.mp4;
  const useNvenc = allowNvenc && codec.video === "libx264" && !req.encoderOverride && hasNvenc();
  const compiled = compileRenderPlan(plan, req.sources!, {
    outputPath: req.outputPath,
    format: project.format,
    quality: project.quality,
    encoderOverride: req.encoderOverride,
    useNvenc,
    videoStabilize: req.videoStabilize,
    gradingFilter: colorGradingFilter(req.colorGrading ?? 0.5),
  });
  return { ...compiled, useNvenc, engine: "compositor", issues: plan.issues };
}

/**
 * يبني وسائط ffmpeg كاملة من المشروع — دالة نقية (عدا كشف NVENC المخزَّن مؤقتاً)
 * تُختبر دون تشغيل ffmpeg. كل القيم الرقمية تأتي من مشروع متحقَّق منه (project-schema).
 */
export function buildExportPlan(req: Omit<ExportRequest, "onProgress" | "signal">, opts: { allowNvenc?: boolean } = {}): ExportPlan {
  const { sourcePath, outputPath, project, videoStabilize, colorGrading, range } = req;
  if (req.sources && (req.forceCompositor || needsCompositor(project, req.sources))) {
    return buildCompositorPlan(req, opts.allowNvenc ?? true);
  }
  let segments = buildSegments(project);
  let imageOverlays = buildImageOverlays(project);
  let subtitles = project.subtitles;
  let textOverlays = project.textOverlays;
  let audioInputs = (req.audioInputs ?? []).slice();
  const extraSources = req.extraSources ?? [];
  // ربط كل مقطع بمدخله حسب assetId (غير المطابق ⇒ المصدر الأساسي 0).
  const indexByAsset = new Map(extraSources.map((s, k) => [s.assetId, k + 1] as const));
  segments = segments.map((s) => ({ ...s, sourceIndex: (s.assetId && indexByAsset.get(s.assetId)) || 0 }));
  if (range) {
    segments = applyRange(segments, range);
    imageOverlays = shiftTimed(imageOverlays, range);
    subtitles = shiftTimed(subtitles, range);
    textOverlays = shiftTimed(textOverlays, range);
    audioInputs = audioInputs.map((a) => ({ ...a, start: r3(a.start - range.start) }));
  }
  if (segments.length === 0) {
    throw new Error("نافذة المعاينة لا تتقاطع مع أي مقطع على التايملاين");
  }
  const [width, height] = req.size ?? resolveOutputSize(project.resolution, project.aspect);
  const { crf, preset } = req.encoderOverride ?? QUALITY_CRF[project.quality] ?? QUALITY_CRF.standard;
  const codec = FORMAT_CODEC[project.format] || FORMAT_CODEC.mp4;
  // تسريع GPU إن توفر (h264 فقط — لا ينطبق على webm/vp9): أسرع حتى 3x مع جودة مماثلة.
  const useNvenc = (opts.allowNvenc ?? true) && codec.video === "libx264" && !req.encoderOverride && hasNvenc();

  const hasText = subtitles.length > 0 || textOverlays.length > 0;
  const assFilename = hasText ? "subs.ass" : null;
  const ass = hasText ? buildAss(subtitles, textOverlays, width, height) : null;

  const gradingFilter = colorGradingFilter(colorGrading ?? 0.5);
  const { filterComplex, audioLabel } = buildFilterComplex({
    segments,
    effects: project.effects,
    imageOverlays,
    audioInputs,
    audioInputOffset: 1 + extraSources.length + imageOverlays.length,
    subtitlesFilename: assFilename,
    width,
    height,
    fps: project.fps,
    videoStabilize,
    gradingFilter,
    sourceHasAudio: req.sourceHasAudio ?? true,
    extraSources,
  });

  const totalDuration = Math.max(
    segments.reduce((sum, s) => sum + (s.outPoint - s.inPoint) / s.speed, 0) -
      (project.effects.includes("fx_slide_l") && segments.length > 1 ? SLIDE_TRANSITION_DURATION * (segments.length - 1) : 0),
    0.1
  );

  const args = [
    "-y",
    "-i", sourcePath,
    ...extraSources.flatMap((s) => ["-i", s.path]),
    // -loop 1 turns a still image into an unbounded video source (otherwise it
    // supplies exactly one frame and the overlay vanishes after a frame).
    ...imageOverlays.flatMap((ov) => ["-loop", "1", "-i", ov.path]),
    ...audioInputs.flatMap((a) => ["-i", a.path]),
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", `[${audioLabel}]`,
    // zoompan (used by several EFFECT_FFMPEG entries) doesn't reliably signal
    // EOF at the source's natural end when chained with other time-aware
    // filters like `subtitles` — verified experimentally: without this cap,
    // a 6s clip kept encoding past 100s. An explicit -t makes the output
    // duration authoritative regardless of what any filter thinks it is.
    "-t", totalDuration.toFixed(3),
    "-r", String(project.fps),
    ...(useNvenc
      ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", String(crf)]
      : [
          "-c:v", codec.video,
          "-crf", String(codec.video === "libvpx-vp9" ? crf * 2 : crf),
          ...(codec.video !== "libvpx-vp9" ? ["-preset", preset] : ["-b:v", "0"]),
        ]),
    "-c:a", codec.audio,
    "-b:a", "192k",
    ...codec.extraArgs,
    // Without -shortest, the looped (infinite) image inputs would keep the
    // encode running forever after the finite base video ends.
    ...(imageOverlays.length > 0 ? ["-shortest"] : []),
    "-progress", "pipe:1",
    "-nostats",
    outputPath,
  ];

  return { args, ass, assFilename, totalDuration, width, height, segmentCount: segments.length, useNvenc, engine: "legacy", issues: [] };
}

export class ExportCancelledError extends Error {
  constructor() {
    super("أُلغي التصدير");
    this.name = "ExportCancelledError";
  }
}

export async function runExport(req: ExportRequest): Promise<{ size: number; durationSeconds: number; width: number; height: number }> {
  const { outputPath, onProgress, signal } = req;
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  if (signal?.aborted) throw new ExportCancelledError();

  const plan = buildExportPlan(req);
  const timeoutMs =
    req.timeoutMs ?? Math.min(2 * 3600_000, Math.round(plan.totalDuration * 20_000) + 5 * 60_000);

  // Written to its own throwaway dir so we can set ffmpeg's cwd there and
  // reference it by bare filename (see the comment above assTimestamp).
  let assDir: string | null = null;
  if (plan.ass && plan.assFilename) {
    assDir = await fsp.mkdtemp(path.join(os.tmpdir(), "montage_ai_ass_"));
    await fsp.writeFile(path.join(assDir, plan.assFilename), plan.ass, "utf-8");
  }

  let outcome: "ok" | "timeout" | "cancel" | "error" = "error";
  try {
    await new Promise<void>((resolve, reject) => {
      const hardened = hardenedSpawn(resolveFfmpegPath(), plan.args);
      const proc = spawn(hardened.cmd, hardened.args, {
        windowsHide: true,
        cwd: assDir || undefined,
        env: childEnv(),
        shell: false,
      });
      let stderrTail = "";
      let killedFor: "timeout" | "cancel" | null = null;
      const kill = (why: "timeout" | "cancel") => {
        if (killedFor) return;
        killedFor = why;
        proc.kill("SIGKILL");
      };
      const timer = setTimeout(() => kill("timeout"), timeoutMs);
      const onAbort = () => kill("cancel");
      signal?.addEventListener("abort", onAbort, { once: true });

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        const match = text.match(/out_time_ms=(\d+)/);
        if (match && onProgress) {
          const outSeconds = Number(match[1]) / 1_000_000;
          onProgress(Math.min(0.99, outSeconds / plan.totalDuration));
        }
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString("utf-8")).slice(-4000);
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (killedFor === "cancel") return reject(new ExportCancelledError());
        if (killedFor === "timeout") return reject(new Error(`تجاوز التصدير المهلة (${Math.round(timeoutMs / 1000)}s)`));
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail.slice(-800)}`));
      });
    });
    outcome = "ok";
  } finally {
    if (assDir) await fsp.rm(assDir, { recursive: true, force: true }).catch(() => {});
    // لا نترك مخرَجاً جزئياً بعد فشل/إلغاء/مهلة — لا يُبلَّغ عن ملف غير مكتمل.
    if (outcome !== "ok") await fsp.rm(outputPath, { force: true }).catch(() => {});
  }

  const stat = await fsp.stat(outputPath);
  onProgress?.(1);
  return { size: stat.size, durationSeconds: plan.totalDuration, width: plan.width, height: plan.height };
}
