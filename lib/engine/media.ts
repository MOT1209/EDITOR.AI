// ====================================================================
// تحليل وسائط حقيقي عبر FFmpeg/FFprobe — بلا أي نتيجة مُختلقة.
// عند تعذّر التحليل يُرمى EngineError (لا fallback عشوائي).
// ====================================================================
import path from "path";
import { EngineError } from "./errors";
import { ffmpegPath, ffprobePath, runProcess } from "./process";

export interface MediaInfo {
  durationSeconds: number;
  sizeBytes: number | null;
  formatName: string;
  video: { codec: string; width: number; height: number; fps: number } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
}

function parseRate(r: string | undefined): number {
  if (!r) return 0;
  const [a, b] = r.split("/").map(Number);
  if (!b) return Number.isFinite(a) ? a : 0;
  return Math.round((a / b) * 1000) / 1000;
}

export async function probeMedia(file: string, signal?: AbortSignal): Promise<MediaInfo> {
  const r = await runProcess(
    ffprobePath(),
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-i", file],
    { timeoutMs: 30_000, signal, maxStdoutBytes: 2 * 1024 * 1024 }
  );
  if (r.code !== 0) {
    // لا نكشف مسارات الخادم المطلقة في رسائل الخطأ.
    const detail = r.stderr.split(file).join(path.basename(file)).trim().slice(-300);
    throw new EngineError("EXECUTION_FAILED", `ffprobe لم يتعرّف على الملف: ${detail || "صيغة غير مدعومة"}`);
  }
  let data: { format?: Record<string, string>; streams?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(r.stdout);
  } catch {
    throw new EngineError("EXECUTION_FAILED", "مخرجات ffprobe غير صالحة");
  }
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && !(s.disposition as Record<string, number> | undefined)?.attached_pic);
  const a = streams.find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration ?? v?.duration ?? a?.duration ?? 0) || 0;
  return {
    durationSeconds: Math.round(duration * 1000) / 1000,
    sizeBytes: data.format?.size ? Number(data.format.size) : null,
    formatName: String(data.format?.format_name ?? "unknown"),
    video: v
      ? { codec: String(v.codec_name), width: Number(v.width) || 0, height: Number(v.height) || 0, fps: parseRate(v.avg_frame_rate as string) || parseRate(v.r_frame_rate as string) }
      : null,
    audio: a ? { codec: String(a.codec_name), sampleRate: Number(a.sample_rate) || 0, channels: Number(a.channels) || 0 } : null,
  };
}

export interface Span {
  start: number;
  end: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** كشف الصمت عبر silencedetect. يتعامل مع صمت ممتد حتى نهاية الملف. */
export async function detectSilence(
  file: string,
  opts: { noiseDb?: number; minDurationSeconds?: number; durationSeconds?: number; signal?: AbortSignal } = {}
): Promise<Span[]> {
  const noise = opts.noiseDb ?? -30;
  const minDur = opts.minDurationSeconds ?? 0.5;
  if (noise > 0 || noise < -90) throw new EngineError("OUT_OF_RANGE", "noiseDb بين -90 و0");
  if (minDur < 0.1 || minDur > 30) throw new EngineError("OUT_OF_RANGE", "minDurationSeconds بين 0.1 و30");
  const r = await runProcess(
    ffmpegPath(),
    ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", `silencedetect=noise=${noise}dB:d=${minDur}`, "-f", "null", "-"],
    { timeoutMs: 10 * 60_000, signal: opts.signal }
  );
  if (r.code !== 0) {
    if (/matches no streams|does not contain any stream/i.test(r.stderr)) {
      throw new EngineError("UNSUPPORTED", "الملف بلا مسار صوت — لا يمكن كشف الصمت");
    }
    throw new EngineError("EXECUTION_FAILED", `فشل silencedetect: ${r.stderr.slice(-300)}`);
  }
  const starts = [...r.stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Math.max(0, parseFloat(m[1])));
  const ends = [...r.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const spans: Span[] = [];
  starts.forEach((s, i) => {
    const e = ends[i] ?? opts.durationSeconds;
    if (e !== undefined && e > s) spans.push({ start: r3(s), end: r3(e) });
  });
  return spans;
}

/** تغيّرات المشهد عبر مرشح select(scene) + showinfo — نقاط قطع بصرية حقيقية. */
export async function analyzeScenes(
  file: string,
  durationSeconds: number,
  opts: { threshold?: number; minSceneSeconds?: number; signal?: AbortSignal } = {}
): Promise<{ cuts: number[]; scenes: Span[] }> {
  const threshold = opts.threshold ?? 0.3;
  const minScene = opts.minSceneSeconds ?? 0.5;
  if (threshold <= 0 || threshold >= 1) throw new EngineError("OUT_OF_RANGE", "threshold بين 0 و1");
  const r = await runProcess(
    ffmpegPath(),
    ["-hide_banner", "-nostats", "-i", file, "-map", "0:v:0", "-an", "-vf", `select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"],
    { timeoutMs: 15 * 60_000, signal: opts.signal }
  );
  if (r.code !== 0) throw new EngineError("EXECUTION_FAILED", `فشل كشف المشاهد: ${r.stderr.slice(-300)}`);
  const raw = [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => parseFloat(m[1])).sort((a, b) => a - b);
  const cuts: number[] = [];
  for (const t of raw) {
    const prev = cuts.length ? cuts[cuts.length - 1] : 0;
    if (t - prev >= minScene && durationSeconds - t >= minScene) cuts.push(r3(t));
  }
  const bounds = [0, ...cuts, durationSeconds];
  const scenes: Span[] = [];
  for (let i = 0; i < bounds.length - 1; i++) scenes.push({ start: r3(bounds[i]), end: r3(bounds[i + 1]) });
  return { cuts, scenes };
}

export interface BeatAnalysis {
  method: "energy-onset";
  bpm: number | null;
  confidence: number;
  onsets: number[];
  analyzedSeconds: number;
}

const BEAT_SR = 8000;
const HOP = 256; // 32ms عند 8kHz

/**
 * كشف الإيقاع: فك ترميز الصوت إلى PCM أحادي 8kHz ثم غلاف بداية (فرق طاقة لوغاريتمي
 * موجب) + انتقاء قمم تكيّفي، وتقدير BPM بالارتباط الذاتي للغلاف في 60–180BPM.
 * طريقة حسابية بسيطة (لا تعلّم آلي) — الثقة مُعادة بصراحة.
 */
export async function detectBeats(
  file: string,
  opts: { maxSeconds?: number; signal?: AbortSignal } = {}
): Promise<BeatAnalysis> {
  const maxSeconds = Math.min(opts.maxSeconds ?? 600, 1800);
  const r = await runProcess(
    ffmpegPath(),
    ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-t", String(maxSeconds), "-ac", "1", "-ar", String(BEAT_SR), "-f", "f32le", "-"],
    { timeoutMs: 5 * 60_000, signal: opts.signal, binaryStdout: true, maxStdoutBytes: maxSeconds * BEAT_SR * 4 + 4096 }
  );
  if (r.code !== 0) {
    if (/matches no streams/i.test(r.stderr)) throw new EngineError("UNSUPPORTED", "الملف بلا مسار صوت");
    throw new EngineError("EXECUTION_FAILED", `فشل فك ترميز الصوت: ${r.stderr.slice(-300)}`);
  }
  const buf = r.stdoutBuffer;
  const n = Math.floor(buf.length / 4);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readFloatLE(i * 4);
  return beatsFromSamples(samples, BEAT_SR);
}

/** الجزء النقي من كشف الإيقاع (قابل للاختبار بإشارة مصنّعة). */
export function beatsFromSamples(samples: Float32Array, sr: number, hop = HOP): BeatAnalysis {
  const frames = Math.floor(samples.length / hop);
  const analyzedSeconds = r3(samples.length / sr);
  if (frames < 8) return { method: "energy-onset", bpm: null, confidence: 0, onsets: [], analyzedSeconds };
  const logE = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += samples[i] * samples[i];
    logE[f] = Math.log10(1e-10 + e / hop);
  }
  const env = new Float32Array(frames);
  for (let f = 1; f < frames; f++) env[f] = Math.max(0, logE[f] - logE[f - 1]);

  // انتقاء قمم: أعلى من (متوسط + 1.5 انحراف) في نافذة ±0.5s، ومسافة دنيا 0.2s.
  const win = Math.max(2, Math.round((0.5 * sr) / hop));
  const minGap = Math.round((0.2 * sr) / hop);
  const onsets: number[] = [];
  let last = -Infinity;
  for (let f = 1; f < frames - 1; f++) {
    if (env[f] <= env[f - 1] || env[f] < env[f + 1]) continue;
    let sum = 0, sq = 0, cnt = 0;
    for (let k = Math.max(0, f - win); k < Math.min(frames, f + win); k++) {
      sum += env[k];
      sq += env[k] * env[k];
      cnt++;
    }
    const mean = sum / cnt;
    const std = Math.sqrt(Math.max(0, sq / cnt - mean * mean));
    if (env[f] > mean + 1.5 * std && env[f] > 0.05 && f - last >= minGap) {
      onsets.push(r3((f * hop) / sr));
      last = f;
    }
  }

  // BPM: ارتباط ذاتي للغلاف بعد طرح المتوسط.
  let mean = 0;
  for (let f = 0; f < frames; f++) mean += env[f];
  mean /= frames;
  // تنعيم الغلاف (نواة مثلثية ±2 إطار): قمم القرع أحادية الإطار ودور غير صحيح
  // بالإطارات يوزّعان الطاقة على تأخيرين متجاورين فيتفوّق ضعف الدور خطأً.
  const smooth = new Float32Array(frames);
  const kernel = [1, 2, 3, 2, 1];
  for (let f = 0; f < frames; f++) {
    let acc = 0, w = 0;
    for (let k = -2; k <= 2; k++) {
      if (f + k >= 0 && f + k < frames) {
        acc += env[f + k] * kernel[k + 2];
        w += kernel[k + 2];
      }
    }
    smooth[f] = acc / w;
  }
  const centered = smooth.map((x) => x - mean);
  let zero = 0;
  for (let f = 0; f < frames; f++) zero += centered[f] * centered[f];
  const minLag = Math.floor((60 / 180) * (sr / hop));
  const maxLag = Math.min(Math.ceil((60 / 60) * (sr / hop)), frames - 2);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1 && lag < frames; lag++) {
    let acc = 0;
    for (let f = lag; f < frames; f++) acc += centered[f] * centered[f - lag];
    ac[lag] = acc / (frames - lag);
  }
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) best = Math.max(best, ac[lag]);
  // تفادي خطأ الأوكتاف: مضاعفات الدور تملك ارتباطاً مماثلاً، فنأخذ أقصر تأخير
  // يكون قمة محلية بنسبة ≥ 85% من الأعلى، ثم تنقيح شبه-قطعي للتأخير الكسري.
  let bestLag = 0;
  for (let lag = Math.max(minLag, 1); lag <= maxLag; lag++) {
    if (ac[lag] >= 0.85 * best && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
      bestLag = lag;
      break;
    }
  }
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const [a, b, c] = [ac[bestLag - 1], ac[bestLag], ac[bestLag + 1]];
    const denom = a - 2 * b + c;
    if (denom !== 0) refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
  }
  const norm = zero > 0 ? best / (zero / frames) : 0;
  const bpm = bestLag > 0 && norm > 0.05 && onsets.length >= 4 ? Math.round(((60 * sr) / (hop * refinedLag)) * 10) / 10 : null;
  return { method: "energy-onset", bpm, confidence: Math.round(Math.max(0, Math.min(1, norm)) * 100) / 100, onsets, analyzedSeconds };
}

export interface RenderReview {
  passed: boolean;
  issues: string[];
  details: {
    exists: boolean;
    sizeBytes?: number;
    durationSeconds?: number;
    hasVideo?: boolean;
    hasAudio?: boolean;
    width?: number;
    height?: number;
    durationDrift?: number;
    blackRatio?: number;
    audioMeanDb?: number;
  };
}

/**
 * مراجعة ما بعد الرندر (نظير src/agents/render_review.py بنفس العتبات):
 * ملف موجود وغير فارغ، مدة > 0 وانحراف ≤ 50%، مسار فيديو، ليس أسود ≥ 50%،
 * وصوت غير صامت (≤ −70dB) عند توقّعه. أي خلل حاسم ⇒ passed=false.
 */
export async function reviewRender(
  file: string,
  expect: { durationSeconds?: number; expectAudio?: boolean; width?: number; height?: number },
  signal?: AbortSignal
): Promise<RenderReview> {
  const { promises: fsp } = await import("fs");
  const st = await fsp.stat(file).catch(() => null);
  if (!st || st.size === 0) return { passed: false, issues: ["ملف الإخراج مفقود أو فارغ"], details: { exists: false } };
  const issues: string[] = [];
  const details: RenderReview["details"] = { exists: true, sizeBytes: st.size };
  let info: MediaInfo;
  try {
    info = await probeMedia(file, signal);
  } catch (e) {
    return { passed: false, issues: [`تعذّر فحص المخرَج: ${(e as Error).message}`], details };
  }
  details.durationSeconds = info.durationSeconds;
  details.hasVideo = !!info.video;
  details.hasAudio = !!info.audio;
  details.width = info.video?.width;
  details.height = info.video?.height;
  if (info.durationSeconds <= 0) issues.push("مدة المخرَج صفر أو غير معروفة");
  if (!info.video) issues.push("لا يوجد مسار فيديو في المخرَج");
  if (expect.width && expect.height && info.video && (info.video.width !== expect.width || info.video.height !== expect.height)) {
    issues.push(`أبعاد المخرَج ${info.video.width}×${info.video.height} ≠ المتوقع ${expect.width}×${expect.height}`);
  }
  if (expect.durationSeconds && expect.durationSeconds > 0 && info.durationSeconds > 0) {
    const drift = Math.abs(info.durationSeconds - expect.durationSeconds) / expect.durationSeconds;
    details.durationDrift = r3(drift);
    if (drift > 0.5) issues.push(`مدة المخرَج ${info.durationSeconds}s تنحرف كثيراً عن المتوقع ${expect.durationSeconds}s`);
  }
  if (info.video && info.durationSeconds > 0) {
    const b = await runProcess(ffmpegPath(), ["-hide_banner", "-nostats", "-i", file, "-map", "0:v:0", "-vf", "blackdetect=d=0.1:pix_th=0.10", "-an", "-f", "null", "-"], { timeoutMs: 10 * 60_000, signal });
    let black = 0;
    for (const m of b.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) black += parseFloat(m[2]) - parseFloat(m[1]);
    details.blackRatio = r3(Math.min(1, black / info.durationSeconds));
    if (details.blackRatio >= 0.5) issues.push(`الفيديو أسود بنسبة ${Math.round(details.blackRatio * 100)}%`);
  }
  if (expect.expectAudio) {
    if (!info.audio) issues.push("الصوت متوقّع لكن لا يوجد مسار صوت");
    else {
      const v = await runProcess(ffmpegPath(), ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { timeoutMs: 10 * 60_000, signal });
      const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(v.stderr);
      if (m) {
        details.audioMeanDb = parseFloat(m[1]);
        if (details.audioMeanDb <= -70) issues.push(`مسار الصوت صامت عملياً (${details.audioMeanDb} dB)`);
      }
    }
  }
  return { passed: issues.length === 0, issues, details };
}
