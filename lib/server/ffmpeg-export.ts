import { spawn, spawnSync } from "child_process";
import { promises as fsp, existsSync, readdirSync } from "fs";
import os from "os";
import path from "path";
import type { ProjectAspect, ProjectState, SubtitleCue, TextOverlay, VideoClip } from "@/lib/types";
import { ASSETS_DIR } from "@/lib/server/assets";

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
  status: "running" | "completed" | "failed";
  progress: number;
  message?: string;
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

// ffmpeg's subtitles filter chokes on a Windows drive-letter colon in an
// absolute path no matter how it's escaped/quoted (tested: backslash-escape
// and single-quote-wrap both fail with "Unable to parse original_size"). The
// reliable workaround is to run ffmpeg with cwd set to the file's directory
// and reference it by bare filename, avoiding the colon entirely.

function assTimestamp(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const csRem = cs % 100;
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(csRem)}`;
}

// TextOverlay.color is a CSS "#RRGGBB" hex; ASS override tags use "&HBBGGRR&"
// (reversed byte order, no leading #).
function cssColorToAssBgr(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || "");
  if (!m) return "FFFFFF";
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)];
  return `${b}${g}${r}`.toUpperCase();
}

const ALIGN_CODE: Record<TextOverlay["position"], number> = { bottom: 2, center: 5, top: 8 };

function assAnimationTag(animation: TextOverlay["animation"]): string {
  if (animation === "fade") return "\\fad(300,300)";
  if (animation === "pop") return "\\t(0,200,\\fscx115\\fscy115)\\t(200,400,\\fscx100\\fscy100)";
  return "";
}

// Regular timed subtitles use a single plain default style (bottom-center) —
// the same look the old plain-.srt rendering produced. Text overlays get an
// inline override tag per line for position/font/size/color, so no per-item
// named ASS style is needed.
export function buildAss(
  subtitles: SubtitleCue[],
  textOverlays: TextOverlay[],
  width: number,
  height: number
): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,44,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,30,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const subtitleLines = subtitles.map(
    (c) => `Dialogue: 0,${assTimestamp(c.start)},${assTimestamp(c.end)},Default,,0,0,0,,${c.text.replace(/\n/g, "\\N")}`
  );

  const overlayLines = textOverlays.map((t) => {
    const align = ALIGN_CODE[t.position] ?? 5;
    const bgr = cssColorToAssBgr(t.color);
    const tags = `{\\an${align}\\fs${t.fontSize}\\c&H${bgr}&${assAnimationTag(t.animation)}}`;
    return `Dialogue: 1,${assTimestamp(t.start)},${assTimestamp(t.end)},Default,,0,0,0,,${tags}${t.text.replace(/\n/g, "\\N")}`;
  });

  return [header, ...subtitleLines, ...overlayLines].join("\n") + "\n";
}

const RESOLUTION_SIZES: Record<string, Record<ProjectAspect, [number, number]>> = {
  "720p": { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [720, 720], "4:5": [720, 900] },
  "1080p": { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] },
  "4k": { "16:9": [3840, 2160], "9:16": [2160, 3840], "1:1": [2160, 2160], "4:5": [2160, 2700] },
};

export function resolveOutputSize(resolution: string, aspect: ProjectAspect): [number, number] {
  return RESOLUTION_SIZES[resolution]?.[aspect] || RESOLUTION_SIZES["1080p"]["16:9"];
}

const QUALITY_CRF: Record<string, { crf: number; preset: string }> = {
  draft: { crf: 32, preset: "veryfast" },
  standard: { crf: 26, preset: "fast" },
  high: { crf: 20, preset: "medium" },
  ultra: { crf: 16, preset: "slow" },
};

// Rough approximations of the editor's CSS preview filters (components/editor/Editor.tsx
// COLOR_FILTERS), expressed as ffmpeg filter chains. Not pixel-identical to the CSS
// preview — good enough for a first real export, refine later if needed.
const COLOR_FILTER_FFMPEG: Record<string, string> = {
  none: "",
  cinematic: "eq=contrast=1.1:saturation=1.15:brightness=-0.03",
  warm: "eq=saturation=1.25:gamma_r=1.05:gamma_b=0.95",
  cool: "eq=saturation=0.9:brightness=0.03,hue=h=12",
  vhs: "eq=contrast=1.2:saturation=0.85,hue=h=5",
  bw: "hue=s=0",
  vivid: "eq=saturation=1.6:contrast=1.1",
  dreamy: "eq=brightness=0.08:saturation=1.15,gblur=sigma=1.2",
};

// Maps EFFECTS_LIBRARY ids (lib/mockAi.ts) to real per-segment ffmpeg filter
// chains, given the segment's duration (seconds) and output canvas size.
// fade/zoom/color/glitch/shake are high-fidelity; light-leak is a stylized
// brightness-pulse approximation (documented — still a real, dynamic, visible
// effect, just not a literal light-leak texture since that needs a second
// blended input source, which is future work).
const EFFECT_FFMPEG: Record<string, (dur: number, w: number, h: number) => string | null> = {
  fx_fade: (dur) =>
    dur > 1
      ? `fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0.5, dur - 0.5).toFixed(3)}:d=0.5`
      : null,
  fx_zoom_punch: (_dur, w, h) => `zoompan=z='min(1+0.0025*on,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}`,
  fx_kenburns: (_dur, w, h) => `zoompan=z='min(1+0.0006*on,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}`,
  fx_zoom_blur: (_dur, w, h) => `zoompan=z='min(1+0.0015*on,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h},gblur=sigma=1.5`,
  fx_shake: () => "crop=iw-24:ih-24:x='12+8*sin(2*PI*t*5)':y='12+6*cos(2*PI*t*7)'",
  fx_glitch: () => "rgbashift=rh=6:bv=-6:edge=smear",
  fx_light_leak: () => "eq=eval=frame:brightness='0.06*sin(2*PI*t*0.4)':saturation=1.1",
  fx_warm: () => COLOR_FILTER_FFMPEG.warm,
  fx_cinematic: () => COLOR_FILTER_FFMPEG.cinematic,
  fx_vhs: () => COLOR_FILTER_FFMPEG.vhs,
  fx_cool: () => COLOR_FILTER_FFMPEG.cool,
  // fx_slide_l is handled structurally in buildFilterComplex (xfade between
  // segments), not as a per-segment filter — it has no entry here.
};

function buildEffectChain(effectIds: string[], dur: number, w: number, h: number): string[] {
  const chain: string[] = [];
  for (const id of effectIds) {
    const build = EFFECT_FFMPEG[id];
    if (!build) continue;
    const filter = build(dur, w, h);
    if (filter) chain.push(filter);
  }
  return chain;
}

const FORMAT_CODEC: Record<string, { video: string; audio: string; extraArgs: string[] }> = {
  mp4: { video: "libx264", audio: "aac", extraArgs: ["-pix_fmt", "yuv420p", "-movflags", "+faststart"] },
  mov: { video: "libx264", audio: "aac", extraArgs: ["-pix_fmt", "yuv420p"] },
  mkv: { video: "libx264", audio: "aac", extraArgs: ["-pix_fmt", "yuv420p"] },
  webm: { video: "libvpx-vp9", audio: "libopus", extraArgs: [] },
};

// Speed changes beyond this range would need chained atempo filters; clamp for v1.
function clampSpeed(speed: number): number {
  return Math.min(2, Math.max(0.5, speed || 1));
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
}

interface Segment {
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

function buildSegments(project: ProjectState): Segment[] {
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
    inPoint: Math.max(0, c.inPoint),
    outPoint: c.outPoint > c.inPoint ? c.outPoint : c.inPoint + c.duration,
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
    .filter((c): c is VideoClip & { imageUrl: string } => c.kind === "image" && !!c.imageUrl && isPathInside(c.imageUrl, ASSETS_DIR))
    .map((c) => ({ path: c.imageUrl, start: c.start, end: c.start + c.duration }));
}

const SLIDE_TRANSITION_DURATION = 0.5;

function buildFilterComplex(
  segments: Segment[],
  effects: string[],
  imageOverlays: ImageOverlay[],
  subtitlesFilename: string | null,
  width: number,
  height: number,
  fps: number,
  videoStabilize?: boolean,
  gradingFilter?: string | null
): { filterComplex: string; audioLabel: string } {
  const parts: string[] = [];
  const durations = segments.map((s) => (s.outPoint - s.inPoint) / s.speed);

  segments.forEach((seg, i) => {
    const colorExpr = COLOR_FILTER_FFMPEG[seg.colorFilter || "none"] || "";
    const effectChain = buildEffectChain(effects, durations[i], width, height);
    const videoChain = [
      `trim=start=${seg.inPoint}:end=${seg.outPoint}`,
      "setpts=(PTS-STARTPTS)" + (seg.speed !== 1 ? `/${seg.speed}` : ""),
      ...(colorExpr ? [colorExpr] : []),
      ...effectChain,
    ].join(",");
    parts.push(`[0:v]${videoChain}[v${i}]`);

    const audioChain = [
      `atrim=start=${seg.inPoint}:end=${seg.outPoint}`,
      "asetpts=PTS-STARTPTS",
      ...(seg.speed !== 1 ? [`atempo=${seg.speed}`] : []),
      ...(seg.volume !== 1 ? [`volume=${seg.volume}`] : []),
    ].join(",");
    parts.push(`[0:a]${audioChain}[a${i}]`);
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
    const inputIndex = i + 1;
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
  if (videoStabilize) {
    // deshake: تثبيت خفيف أحادي الممر (بديل عملي لـ vidstab الذي يتطلب ممرين).
    finalOps.push("deshake=rx=16:ry=16:edge=mirror");
  }
  if (gradingFilter) {
    finalOps.push(gradingFilter);
  }
  if (subtitlesFilename) {
    finalOps.push(`subtitles=${subtitlesFilename}`);
  }
  parts.push(`[${videoLabel}]${finalOps.join(",")}[vout]`);

  // ضبط الصوت التلقائي (تحسين نهائي): إزالة ضوضاء خفيفة (afftdn) ثم
  // تطبيع مستوى الصوت لمعيار السوشال ميديا (-16 LUFS) لضمان وضوح الكلام
  // فوق الموسيقى الخلفية.
  if (audioLabel) {
    const enhancedAudio = "aenh";
    parts.push(`[${audioLabel}]afftdn=nr=12:nf=-35,loudnorm=I=-16:TP=-1.5:LRA=11[aenh]`);
    audioLabel = enhancedAudio;
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

export async function runExport(req: ExportRequest): Promise<{ size: number }> {
  const { sourcePath, outputPath, project, onProgress, videoStabilize, colorGrading } = req;
  await ensureExportDir();

  const segments = buildSegments(project);
  const imageOverlays = buildImageOverlays(project);
  const [width, height] = resolveOutputSize(project.resolution, project.aspect);
  const { crf, preset } = QUALITY_CRF[project.quality] || QUALITY_CRF.standard;
  const codec = FORMAT_CODEC[project.format] || FORMAT_CODEC.mp4;
  // تسريع GPU إن توفر (h264 فقط — لا ينطبق على webm/vp9): أسرع حتى 3x مع جودة مماثلة.
  const useNvenc =
    codec.video === "libx264" && hasNvenc();

  // Written to its own throwaway dir so we can set ffmpeg's cwd there and
  // reference it by bare filename (see the comment above assTimestamp).
  let assDir: string | null = null;
  let assFilename: string | null = null;
  if (project.subtitles.length > 0 || project.textOverlays.length > 0) {
    assDir = await fsp.mkdtemp(path.join(os.tmpdir(), "montage_ai_ass_"));
    assFilename = "subs.ass";
    await fsp.writeFile(
      path.join(assDir, assFilename),
      buildAss(project.subtitles, project.textOverlays, width, height),
      "utf-8"
    );
  }

  const gradingFilter = colorGradingFilter(colorGrading ?? 0.5);
  const { filterComplex, audioLabel } = buildFilterComplex(
    segments,
    project.effects,
    imageOverlays,
    assFilename,
    width,
    height,
    project.fps,
    videoStabilize,
    gradingFilter
  );

  const totalDuration = Math.max(
    segments.reduce((sum, s) => sum + (s.outPoint - s.inPoint) / s.speed, 0),
    0.1
  );

  const args = [
    "-y",
    "-i", sourcePath,
    // -loop 1 turns a still image into an unbounded video source (otherwise it
    // supplies exactly one frame and the overlay vanishes after a frame).
    ...imageOverlays.flatMap((ov) => ["-loop", "1", "-i", ov.path]),
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
          ...(codec.video !== "libvpx-vp9" ? ["-preset", preset] : []),
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

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(resolveFfmpegPath(), args, {
      windowsHide: true,
      cwd: assDir || undefined,
    });
    let stderrTail = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      const match = text.match(/out_time_ms=(\d+)/);
      if (match && onProgress) {
        const outSeconds = Number(match[1]) / 1_000_000;
        onProgress(Math.min(0.99, outSeconds / totalDuration));
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf-8")).slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail.slice(-800)}`));
    });
  }).finally(async () => {
    if (assDir) await fsp.rm(assDir, { recursive: true, force: true }).catch(() => {});
  });

  const stat = await fsp.stat(outputPath);
  onProgress?.(1);
  return { size: stat.size };
}
