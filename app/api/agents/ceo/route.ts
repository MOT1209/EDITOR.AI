import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { promises as fsp, existsSync } from "fs";
import os from "os";
import path from "path";
import { v4 as uuid } from "uuid";
import {
  getOpencodeKey,
  getOpencodeBaseUrl,
  getChatModel,
  getVisionModel,
  getWhisperModel,
} from "@/lib/server/api-keys";
import { hasFfmpeg, resolveFfmpegPath } from "@/lib/server/ffmpeg-export";
import type {
  CeoResponse,
  DirectorPlan,
  HighlightInfo,
  MusicMood,
  PlanOverlay,
  PlanSegment,
  QualityInfo,
  SceneInfo,
  TranscriptSegment,
} from "@/lib/agents/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const UPLOAD_DIR = path.join(process.cwd(), ".montage_ai", "uploads");
const NULL_DEVICE = os.platform() === "win32" ? "NUL" : "/dev/null";

const COLOR_FILTERS = ["none", "cinematic", "warm", "cool", "vhs", "bw", "vivid", "dreamy"];
const MUSIC_MOODS: MusicMood[] = ["ملهم", "مريح", "سعيد", "متوتر", "احترافي", "حالم", "قوي", "دافئ"];
const CAPTION_STYLES = ["default", "bold", "highlight", "karaoke"];
const OVERLAY_POSITIONS = ["top", "center", "bottom"];
const MAX_SEGMENTS = 60;

/* ------------------------------------------------------------------ */
/* أدوات التحليل (Data Analyst)                                        */
/* ------------------------------------------------------------------ */

async function ensureDir(p: string) {
  try {
    await fsp.mkdir(p, { recursive: true });
  } catch {}
}

function detectSilencesFfmpeg(filePath: string): { start: number; end: number }[] {
  if (!hasFfmpeg()) return [];
  const r = spawnSync(
    resolveFfmpegPath(),
    [
      "-i", filePath,
      "-map", "0:a",
      "-af", "silencedetect=noise=-25dB:d=0.4",
      "-f", "null",
      NULL_DEVICE,
    ],
    { encoding: "utf-8", timeout: 60000 }
  );
  const out = `${r.stderr || ""}${r.stdout || ""}`;
  const starts: number[] = [];
  const ends: number[] = [];
  let m;
  const sr = /silence_start:\s*([\d.]+)/g;
  while ((m = sr.exec(out)) !== null) starts.push(parseFloat(m[1]));
  const er = /silence_end:\s*([\d.]+)/g;
  while ((m = er.exec(out)) !== null) ends.push(parseFloat(m[1]));
  const segs: { start: number; end: number }[] = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    if (ends[i] - starts[i] >= 0.4) segs.push({ start: starts[i], end: ends[i] });
  }
  // صمت في نهاية الفيديو (لا يوجد silence_end بعده)
  if (starts.length > ends.length) segs.push({ start: starts[starts.length - 1], end: Number.MAX_SAFE_INTEGER });
  return segs;
}

/**
 * استخراج الصوت للتفريغ. Whisper يقبل حتى 25MB — نستخدم mp3 16kHz mono
 * (≈0.24MB/دقيقة) ليدعم مقاطع أطول بكثير من الـ wav الخام.
 */
async function extractAudioMp3(filePath: string): Promise<string | null> {
  if (!hasFfmpeg()) return null;
  const out = path.join(os.tmpdir(), `montage_ceo_${uuid()}.mp3`);
  const r = spawnSync(
    resolveFfmpegPath(),
    [
      "-i", filePath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "libmp3lame",
      "-b:a", "32k",
      "-y", out,
    ],
    { encoding: "utf-8", timeout: 180000 }
  );
  if (r.status !== 0 || !existsSync(out)) return null;
  return out;
}

async function transcribeWhisper(
  apiKey: string,
  baseUrl: string,
  audioPath: string,
  language: string
): Promise<{ text: string; segments: TranscriptSegment[]; words: { text: string; start: number; end: number }[] }> {
  const buf = await fsp.readFile(audioPath);
  const form = new FormData();
  form.append("file", new File([buf], "audio.mp3", { type: "audio/mpeg" }));
  form.append("model", getWhisperModel());
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (language) form.append("language", language);

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper API error (${res.status})`);
  const data = await res.json();

  const words = (data.words || [])
    .map((w: { word?: string; text?: string; start: number; end: number }) => ({
      text: String(w.word ?? w.text ?? "").trim(),
      start: w.start,
      end: w.end,
    }))
    .filter((w: { text: string }) => w.text.length > 0);

  const segments = (data.segments || [])
    .map((s: { start: number; end: number; text: string }) => ({
      start: s.start,
      end: s.end,
      text: String(s.text || "").trim(),
    }))
    .filter((s: { text: string }) => s.text.length > 0);

  return { text: data.text || "", segments, words };
}

function mockTranscript(duration: number): TranscriptSegment[] {
  const segs: TranscriptSegment[] = [];
  const n = Math.max(3, Math.floor(duration / 8));
  const len = duration / n;
  const phrases = [
    "في هذا الفيديو سنتعرف على أهم النقاط",
    "أهلاً بكم في رحلتنا الجديدة",
    "أهم نقطة يجب أن نلاحظها هي",
    "الذكاء الاصطناعي يغير العالم",
    "تابعوا معي حتى النهاية",
    "شكراً لمشاهدتكم",
  ];
  for (let i = 0; i < n; i++) {
    segs.push({
      start: i * len,
      end: Math.min((i + 1) * len, duration),
      text: phrases[i % phrases.length],
    });
  }
  return segs;
}

async function captureFrames(filePath: string, duration: number): Promise<string[]> {
  if (!hasFfmpeg()) return [];
  const frames: string[] = [];
  const count = Math.min(4, Math.max(2, Math.floor(duration / 20)));
  const safeDur = Math.max(0.5, duration - 0.2);
  for (let i = 0; i < count; i++) {
    const t = Math.min((i / count) * duration + duration / count / 2, safeDur);
    const tmp = path.join(os.tmpdir(), `montage_frame_${uuid()}.jpg`);
    const r = spawnSync(
      resolveFfmpegPath(),
      ["-ss", String(t), "-i", filePath, "-frames:v", "1", "-vf", "scale=640:-1", "-q:v", "5", "-y", tmp],
      { encoding: "utf-8", timeout: 60000 }
    );
    if (r.status === 0 && existsSync(tmp)) {
      try {
        const buf = await fsp.readFile(tmp);
        frames.push(buf.toString("base64"));
      } catch {}
      await fsp.unlink(tmp).catch(() => {});
    }
  }
  return frames;
}

/** تحليل بصري واحد: مشاهد + لحظات مميزة + جودة + وصف المحتوى. */
async function analyzeVision(
  apiKey: string,
  baseUrl: string,
  frames: string[],
  duration: number
): Promise<{
  scenes: SceneInfo[];
  highlights: HighlightInfo[];
  quality: QualityInfo;
  content: string;
} | null> {
  if (!apiKey || frames.length === 0) return null;
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `هذا فيديو مدته ${Math.round(duration)} ثانية، وهذه ${frames.length} لقطات ممثلة منه. حلل: 1) المشاهد الرئيسية (start/end/score 0-1) 2) اللحظات المميزة (highlights مع reason) 3) جودة الصورة brightness/contrast/saturation/sharpness من 0 إلى 1 4) وصف موجز للمحتوى والموضوع (content). أخرج JSON فقط بالشكل: {"scenes":[{"start":0,"end":10,"score":0.8,"description":"..."}],"highlights":[{"start":5,"end":8,"reason":"..."}],"quality":{"brightness":0.7,"contrast":0.6,"saturation":0.5,"sharpness":0.8},"content":"وصف"}`,
    },
  ];
  frames.forEach((f) =>
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f}` } })
  );

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getVisionModel(),
      messages: [{ role: "user", content }],
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json();
  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    return {
      scenes: parsed.scenes || [],
      highlights: parsed.highlights || [],
      quality: parsed.quality || { brightness: 0.6, contrast: 0.6, saturation: 0.6, sharpness: 0.6 },
      content: String(parsed.content || ""),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* وكيلة المديرة التنفيذية (CEO) — القرار النهائي                      */
/* ------------------------------------------------------------------ */

interface DirectorContext {
  request: string;
  language: string;
  moodHint: string;
  duration: number;
  transcript: string;
  segments: TranscriptSegment[];
  silences: { start: number; end: number }[];
  scenes: SceneInfo[];
  highlights: HighlightInfo[];
  quality: QualityInfo;
  contentDesc: string;
}

const DIRECTOR_SYSTEM_PROMPT = `أنت "المديرة التنفيذية" (CEO / Executive Producer) لوكالة إنتاج فيديو آلية تعمل بالذكاء الاصطناعي.

مسؤولياتك:
1. استلام طلب المستخدم وملف الفيديو وتحليل بياناته (تفريغ صوتي بتوقيتات الكلمات، فترات الصمت، المشاهد، اللحظات المميزة، جودة الصورة).
2. وضع خطة مونتاج كاملة (EDL) تخدم هدف المستخدم وتحقق أعلى نسبة احتفاظ بالمشاهد (Retention) لمنصات Reels / Shorts / YouTube.
3. قواعد صارمة للاحتفاظ بالمشاهد:
   - اقصِ فترات الصمت الطويلة (>0.6 ثانية) والمقدمات المملة.
   - ابدأ بخطاف قوي في أول ثانيتين.
   - تسريع الأجزاء البطيئة (speed 1.1-1.3) بدل حذفها إذا كانت مهمة.
   - أبقِ اللحظات العاطفية/المهمة بسرعتها الأصلية.
   - لا تترك فواصل صامتة طويلة بين المقاطع المحتفظ بها.
4. قرر: الفلتر اللوني، مزاج الموسيقى، تفعيل الترجمة ونمطها، النصوص التوضيحية (overlays)، العنوان والوصف والوسوم.

قواعد الإخراج (صارمة):
- أعد JSON فقط بدون أي نص خارجي.
- segments يجب أن تغطي الفيديو بالكامل من 0 إلى المدة دون ثغرات وتكون مرتبة تصاعدياً.
- كل segment له start و end (ثوانٍ) و keep (true/false) و reason قصيرة.
- لا تدخل أرقاماً خارج نطاق الفيديو (0..duration).
- الترجمة مفعّلة افتراضياً (captions=true) لأنها ترفع الاحتفاظ.
- اختر الفلاتر من القائمة حصراً: none, cinematic, warm, cool, vhs, bw, vivid, dreamy.
- اختر مزاج الموسيقى من القائمة حصراً: ملهم, مريح, سعيد, متوتر, احترافي, حالم, قوي, دافئ.
- نمط الترجمة من: default, bold, highlight, karaoke.
- textOverlays: 1-3 نصوص قصيرة (مثل عنوان الأقسام) مع position من: top, center, bottom.

مخطط JSON المطلوب:
{"title":"...","description":"...","tags":["..."],"summary":"ملخص الخطة للمستخدم","style":{"colorFilter":"...","musicMood":"...","captions":true,"captionStyle":"...","musicVolume":0.5},"segments":[{"start":0,"end":3.2,"keep":true,"speed":1,"reason":"..."}],"textOverlays":[{"text":"...","start":0,"end":2,"position":"top"}]}`;

async function directorPlan(
  apiKey: string,
  baseUrl: string,
  ctx: DirectorContext
): Promise<DirectorPlan> {
  const compactWords =
    ctx.segments
      .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
      .join("\n")
      .slice(0, 9000) || "(لا يوجد تفريغ متاح)";

  const silencesText =
    ctx.silences.length > 0
      ? ctx.silences.map((s) => `صمت ${s.start.toFixed(1)}s → ${s.end.toFixed(1)}s`).join("، ").slice(0, 1500)
      : "(غير متاح)";

  const scenesText =
    ctx.scenes.length > 0
      ? ctx.scenes
          .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] درجة ${s.score?.toFixed(2) ?? "?"} ${s.description || ""}`)
          .join("\n")
          .slice(0, 1200)
      : "(غير متاح)";

  const highlightsText =
    ctx.highlights.length > 0
      ? ctx.highlights
          .map((h) => `[${h.start.toFixed(1)}-${h.end.toFixed(1)}] ${h.reason}`)
          .join("\n")
          .slice(0, 800)
      : "(غير متاح)";

  const userContent = `طلب المستخدم: "${ctx.request || "(لا يوجد طلب محدد — نفذي مونتاجاً جذاباً عاماً)"}"

بيانات الفيديو:
- المدة: ${ctx.duration.toFixed(1)} ثانية
- اللغة: ${ctx.language}
- تفضيل مزاج موسيقي (تلميح): ${ctx.moodHint}

التفريغ الصوتي (بتوقيتات):
${compactWords}

فترات الصمت المكتشفة:
${silencesText}

المشاهد:
${scenesText}

اللحظات المميزة:
${highlightsText}

جودة الصورة: ${JSON.stringify(ctx.quality)}
وصف المحتوى: ${ctx.contentDesc || "(غير متاح)"}

قرري خطة المونتاج النهائية (EDL) حسب قواعدك. أخرج JSON فقط.`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getChatModel(),
      messages: [
        { role: "system", content: DIRECTOR_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  }).catch(() => null);
  if (!res || !res.ok) throw new Error(`Director LLM error (${res ? res.status : "network"})`);
  const data = await res.json();
  const raw = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  if (!raw.segments || !Array.isArray(raw.segments)) {
    throw new Error("الخطة لم تتضمن segments صالحة");
  }
  return raw as DirectorPlan;
}

/* ------------------------------------------------------------------ */
/* خطة بديلة محلية (بدون API key) + تطبيع الخطة                       */
/* ------------------------------------------------------------------ */

function fallbackPlan(
  duration: number,
  silences: { start: number; end: number }[],
  moodHint: string
): DirectorPlan {
  const mood: MusicMood = (MUSIC_MOODS.includes(moodHint as MusicMood) ? moodHint : "ملهم") as MusicMood;
  const segments: PlanSegment[] = [];
  if (silences.length === 0) {
    segments.push({ start: 0, end: duration, keep: true, speed: 1, reason: "الفيديو كامل" });
  } else {
    let cursor = 0;
    for (const s of silences) {
      if (s.start > cursor + 0.3) {
        segments.push({ start: cursor, end: s.start, keep: true, speed: 1, reason: "مقطع كلامي" });
      }
      segments.push({ start: s.start, end: s.end, keep: false, reason: "صمت مكتشف" });
      cursor = Math.max(cursor, s.end);
    }
    if (cursor < duration - 0.3) {
      segments.push({ start: cursor, end: duration, keep: true, speed: 1, reason: "الخاتمة" });
    }
  }
  return {
    title: "فيديو محسّن بالمديرة التنفيذية",
    description: `تم توليد هذه الخطة محلياً لأن مفتاح API غير مضبوط. فعّل مفتاح OpenAI/Gemini من إعدادات API لخطة ذكية كاملة.`,
    tags: ["مونتاج", "تلقائي"],
    summary: "خطة محلية: قص الصمت + ترجمة + موسيقى",
    style: { colorFilter: "cinematic", musicMood: mood, captions: true, captionStyle: "default", musicVolume: 0.5 },
    segments,
    textOverlays: [],
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function normalizePlan(plan: DirectorPlan, duration: number): DirectorPlan {
  // أجزاء القص
  let segs: PlanSegment[] = (plan.segments || [])
    .map((s) => ({
      start: clamp(Number(s.start) || 0, 0, duration),
      end: clamp(Number(s.end) || 0, 0, duration),
      keep: Boolean(s.keep),
      speed: clamp(Number(s.speed) || 1, 0.5, 3),
      reason: String(s.reason || "").slice(0, 80),
    }))
    .filter((s) => s.end - s.start >= 0.2)
    .sort((a, b) => a.start - b.start);

  // ادمج التداخلات
  const merged: PlanSegment[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      last.keep = last.keep && s.keep;
    } else {
      merged.push(s);
    }
  }
  segs = merged;

  // إن لم تُغطَّ الخطة الفيديو، أضف ما تبقى كإبقاء.
  if (segs.length === 0) {
    segs.push({ start: 0, end: duration, keep: true, speed: 1, reason: "الفيديو كامل" });
  } else {
    if (segs[0].start > 0.3) {
      segs.unshift({ start: 0, end: segs[0].start, keep: true, speed: 1, reason: "البداية" });
    }
    const lastEnd = segs[segs.length - 1].end;
    if (duration - lastEnd > 0.3) {
      segs.push({ start: lastEnd, end: duration, keep: true, speed: 1, reason: "الخاتمة" });
    }
  }

  // حد أقصى لعدد الأجزاء (حماية من خطط ضخمة)
  if (segs.length > MAX_SEGMENTS) {
    const keepCount = segs.filter((s) => s.keep).length;
    if (keepCount > MAX_SEGMENTS) {
      // أبسط: قسم متساوٍ على كل الفيديو المحتفظ به
      const keptRanges = segs.filter((s) => s.keep).map((s) => [s.start, s.end]);
      const combined: PlanSegment[] = [];
      let cur: [number, number] | null = null;
      for (const [a, b] of keptRanges) {
        if (!cur) cur = [a, b];
        else if (a <= cur[1] + 0.1) cur[1] = Math.max(cur[1], b);
        else {
          combined.push({ start: cur[0], end: cur[1], keep: true, speed: 1, reason: "مقطع" });
          cur = [a, b];
        }
      }
      if (cur) combined.push({ start: cur[0], end: cur[1], keep: true, speed: 1, reason: "مقطع" });
      segs = combined;
    }
  }

  // النصوص التوضيحية
  const overlays: PlanOverlay[] = ((plan.textOverlays || []) as PlanOverlay[])
    .map((o) => ({
      text: String(o.text || "").slice(0, 60),
      start: clamp(Number(o.start) || 0, 0, duration),
      end: clamp(Number(o.end) || 0, 0, duration),
      position: (OVERLAY_POSITIONS.includes(o.position) ? o.position : "top") as PlanOverlay["position"],
    }))
    .filter((o) => o.text && o.end > o.start)
    .slice(0, 5);

  // الأنماط
  const colorFilter = plan.style?.colorFilter && COLOR_FILTERS.includes(plan.style.colorFilter)
    ? plan.style.colorFilter
    : "none";
  const musicMood = (MUSIC_MOODS.includes(plan.style?.musicMood) ? plan.style.musicMood : "ملهم") as MusicMood;
  const captionStyle = CAPTION_STYLES.includes(plan.style?.captionStyle)
    ? plan.style.captionStyle
    : "default";

  return {
    title: String(plan.title || "فيديو المديرة التنفيذية").slice(0, 120),
    description: String(plan.description || "").slice(0, 500),
    tags: (plan.tags || []).map(String).slice(0, 10),
    summary: String(plan.summary || "").slice(0, 300),
    style: {
      colorFilter,
      musicMood,
      captions: plan.style?.captions !== false,
      captionStyle,
      musicVolume: clamp(Number(plan.style?.musicVolume) || 0.5, 0, 1),
    },
    segments: segs,
    textOverlays: overlays,
  };
}

/* ------------------------------------------------------------------ */
/* نقطة النهاية                                                       */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const request = String(form.get("request") || "").slice(0, 800);
    const language = String(form.get("language") || "ar").slice(0, 10);
    const moodHint = String(form.get("moodHint") || "ملهم").slice(0, 20);
    const durationInput = parseFloat(String(form.get("duration") || "0"));

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "ملف الفيديو مطلوب" }, { status: 400 });
    }

    const apiKey = getOpencodeKey(req);
    const baseUrl = getOpencodeBaseUrl();

    // 1) احفظ الفيديو على الخادم
    await ensureDir(UPLOAD_DIR);
    const id = uuid();
    const ext = path.extname(file.name) || ".mp4";
    const filePath = path.join(UPLOAD_DIR, `${id}${ext}`);
    const buf = Buffer.from(await file.arrayBuffer());
    await fsp.writeFile(filePath, buf);

    // 2) المدة الفعلية
    let duration = durationInput;
    if (!duration || duration <= 0) {
      const pr = spawnSync(resolveFfmpegPath(), ["-i", filePath], { encoding: "utf-8", timeout: 30000 });
      const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(`${pr.stderr || ""}`);
      if (m) duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]);
    }
    if (!duration || duration <= 0) duration = 30;
    duration = Math.min(duration, 3600); // سقف ساعة حمايةً للموارد

    // 3) تحليل الصمت
    const silences = detectSilencesFfmpeg(filePath);

    // 4) التفريغ الصوتي (Word-level) عبر Whisper
    let transcript = "";
    let segments: TranscriptSegment[] = [];
    if (apiKey) {
      let audioPath: string | null = null;
      try {
        audioPath = await extractAudioMp3(filePath);
        if (audioPath) {
          const w = await transcribeWhisper(apiKey, baseUrl, audioPath, language);
          transcript = w.text;
          segments = w.segments;
        }
      } catch {
        /* نكمل بدون تفريغ حقيقي */
      }
      if (audioPath) await fsp.unlink(audioPath).catch(() => {});
    }
    if (segments.length === 0) {
      segments = mockTranscript(duration);
      transcript = segments.map((s) => s.text).join(" ");
    }

    // 5) التحليل البصري
    const frames = await captureFrames(filePath, duration);
    const vision = apiKey ? await analyzeVision(apiKey, baseUrl, frames, duration) : null;
    const scenes: SceneInfo[] = vision?.scenes || [];
    const highlights: HighlightInfo[] = vision?.highlights || [];
    const quality: QualityInfo =
      vision?.quality || { brightness: 0.6, contrast: 0.6, saturation: 0.6, sharpness: 0.6 };
    const contentDesc = vision?.content || "";

    // 6) قرار المديرة التنفيذية
    let plan: DirectorPlan | null = null;
    let mock = false;
    if (apiKey) {
      try {
        plan = await directorPlan(apiKey, baseUrl, {
          request,
          language,
          moodHint,
          duration,
          transcript,
          segments,
          silences,
          scenes,
          highlights,
          quality,
          contentDesc,
        });
      } catch {
        plan = null;
      }
    }
    if (!plan) {
      plan = fallbackPlan(duration, silences, moodHint);
      mock = true;
    }
    plan = normalizePlan(plan, duration);

    const response: CeoResponse = {
      plan,
      transcript,
      segments,
      silences,
      scenes,
      highlights,
      quality,
      filePath,
      mock,
    };
    return NextResponse.json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
