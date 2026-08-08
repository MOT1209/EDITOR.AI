import type {
  AIJob,
  Effect,
  MusicTrack,
  ProjectState,
  SubtitleCue,
} from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let jobCounter = 0;
const jobs = new Map<string, AIJob>();

export const aiJobs = {
  list(): AIJob[] {
    return Array.from(jobs.values()).sort((a, b) => b.startedAt! - a.startedAt!);
  },
  get(id: string) {
    return jobs.get(id);
  },
  create(kind: string, label: string): AIJob {
    const id = `job_${Date.now()}_${++jobCounter}`;
    const job: AIJob = {
      id,
      kind,
      label,
      status: "running",
      progress: 0,
      startedAt: Date.now(),
    };
    jobs.set(id, job);
    return job;
  },
  update(id: string, patch: Partial<AIJob>) {
    const job = jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
  },
  complete(id: string, result?: unknown) {
    const job = jobs.get(id);
    if (!job) return;
    job.status = "completed";
    job.progress = 100;
    job.result = result;
    job.finishedAt = Date.now();
  },
  fail(id: string, message: string) {
    const job = jobs.get(id);
    if (!job) return;
    job.status = "failed";
    job.message = message;
    job.finishedAt = Date.now();
  },
};

export const EFFECTS_LIBRARY: Effect[] = [
  {
    id: "fx_fade",
    name: "تلاشي ناعم",
    category: "transition",
    preview: "fade",
    intensity: 0.6,
  },
  {
    id: "fx_zoom_punch",
    name: "تكبير درامي",
    category: "motion",
    preview: "zoom",
    intensity: 0.8,
  },
  {
    id: "fx_glitch",
    name: "غلتش رقمي",
    category: "vfx",
    preview: "glitch",
    intensity: 0.5,
  },
  {
    id: "fx_warm",
    name: "لون دافئ",
    category: "color",
    preview: "warm",
    intensity: 0.65,
  },
  {
    id: "fx_cinematic",
    name: "سينمائي",
    category: "color",
    preview: "cinematic",
    intensity: 0.7,
  },
  {
    id: "fx_vhs",
    name: "VHS قديم",
    category: "vfx",
    preview: "vhs",
    intensity: 0.55,
  },
  {
    id: "fx_light_leak",
    name: "تسرّب ضوئي",
    category: "vfx",
    preview: "leak",
    intensity: 0.4,
  },
  {
    id: "fx_shake",
    name: "اهتزاز خفيف",
    category: "motion",
    preview: "shake",
    intensity: 0.3,
  },
  {
    id: "fx_slide_l",
    name: "انزلاق لليسار",
    category: "transition",
    preview: "slide-l",
    intensity: 0.5,
  },
  {
    id: "fx_zoom_blur",
    name: "تكبير ضبابي",
    category: "motion",
    preview: "zoom-blur",
    intensity: 0.6,
  },
  {
    id: "fx_cool",
    name: "لون بارد",
    category: "color",
    preview: "cool",
    intensity: 0.65,
  },
  {
    id: "fx_kenburns",
    name: "Ken Burns",
    category: "motion",
    preview: "kenburns",
    intensity: 0.5,
  },
];

export const MUSIC_LIBRARY: MusicTrack[] = [
  {
    id: "m_epic",
    title: "ملحمة سينمائية",
    genre: "Cinematic",
    mood: "ملهم",
    duration: 180,
    bpm: 90,
    url: "",
    cover: "linear-gradient(135deg,#7c3aed,#06b6d4)",
  },
  {
    id: "m_chill",
    title: "هادئ ومرتاح",
    genre: "Lo-Fi",
    mood: "مريح",
    duration: 240,
    bpm: 75,
    url: "",
    cover: "linear-gradient(135deg,#06b6d4,#3b82f6)",
  },
  {
    id: "m_upbeat",
    title: "نشيط ومرح",
    genre: "Pop",
    mood: "سعيد",
    duration: 160,
    bpm: 120,
    url: "",
    cover: "linear-gradient(135deg,#f59e0b,#ef4444)",
  },
  {
    id: "m_dark",
    title: "ظلام وغموض",
    genre: "Dark Ambient",
    mood: "متوتر",
    duration: 200,
    bpm: 70,
    url: "",
    cover: "linear-gradient(135deg,#0f172a,#7c3aed)",
  },
  {
    id: "m_corporate",
    title: "أعمال احترافية",
    genre: "Corporate",
    mood: "احترافي",
    duration: 150,
    bpm: 110,
    url: "",
    cover: "linear-gradient(135deg,#10b981,#06b6d4)",
  },
  {
    id: "m_romantic",
    title: "رومانسي ناعم",
    genre: "Romance",
    mood: "حالم",
    duration: 220,
    bpm: 80,
    url: "",
    cover: "linear-gradient(135deg,#ec4899,#f59e0b)",
  },
  {
    id: "m_rock",
    title: "طاقة الروك",
    genre: "Rock",
    mood: "قوي",
    duration: 190,
    bpm: 140,
    url: "",
    cover: "linear-gradient(135deg,#ef4444,#7c3aed)",
  },
  {
    id: "m_acoustic",
    title: "صوت هادئ",
    genre: "Acoustic",
    mood: "دافئ",
    duration: 210,
    bpm: 85,
    url: "",
    cover: "linear-gradient(135deg,#f59e0b,#10b981)",
  },
];

const ARABIC_SAMPLE_PHRASES = [
  "في هذا الفيديو سنتعرف على",
  "أهلاً بكم في رحلتنا الجديدة",
  "أهم نقطة يجب أن نلاحظها هي",
  "الذكاء الاصطناعي يغير العالم",
  "سأشرح لكم الطريقة خطوة بخطوة",
  "هذا هو السر الذي لم يذكره أحد",
  "في البداية دعوني أعرفكم بنفسي",
  "النتيجة النهائية كانت مذهلة",
  "جربت هذه التقنية لمدة شهر كامل",
  "واليوم سأشارككم تجربتي",
  "أحد أهم الأسباب التي أدهشتني",
  "كل ما تحتاجه هو هذه الأداة البسيطة",
  "تابعوا معي حتى النهاية",
  "الخطوة الأولى سهلة جداً",
  "لكن الخطوة الثانية هي الأهم",
  "إذا وصلت إلى هنا فأنت بطل",
  "شكراً لمشاهدتكم ولا تنسوا الاشتراك",
  "أراكم في الفيديو القادم بإذن الله",
];

export async function analyzeVideoAI(
  project: ProjectState,
  onProgress?: (p: number, msg?: string) => void
): Promise<{
  scenes: { start: number; end: number; score: number }[];
  highlights: { start: number; end: number; reason: string }[];
  faces: { start: number; end: number; x: number; y: number; w: number; h: number }[];
  quality: { brightness: number; contrast: number; saturation: number; sharpness: number };
  duration: number;
}> {
  const total = project.duration || 30;
  const steps = 6;
  const result = {
    scenes: [] as { start: number; end: number; score: number }[],
    highlights: [] as { start: number; end: number; reason: string }[],
    faces: [] as { start: number; end: number; x: number; y: number; w: number; h: number }[],
    quality: { brightness: 0.5, contrast: 0.6, saturation: 0.7, sharpness: 0.7 },
    duration: total,
  };

  for (let i = 0; i < steps; i++) {
    await sleep(220);
    onProgress?.(((i + 1) / steps) * 100, `تحليل المشهد ${i + 1}/${steps}`);
  }

  const sceneCount = Math.max(3, Math.floor(total / 6));
  for (let i = 0; i < sceneCount; i++) {
    const start = (i / sceneCount) * total;
    const end = ((i + 1) / sceneCount) * total;
    const score = 0.4 + Math.random() * 0.6;
    result.scenes.push({ start, end, score });
    if (score > 0.75) {
      const reasons = [
        "لحظة عاطفية قوية",
        "تعبير وجه مميز",
        "حركة درامية",
        "إضاءة سينمائية",
        "ذروة الكلام",
      ];
      result.highlights.push({
        start,
        end: Math.min(end, start + 3),
        reason: reasons[Math.floor(Math.random() * reasons.length)],
      });
    }
  }

  const faceCount = Math.max(1, Math.floor(total / 4));
  for (let i = 0; i < faceCount; i++) {
    const start = (i / faceCount) * total;
    const end = Math.min(start + 2 + Math.random() * 3, total);
    result.faces.push({
      start,
      end,
      x: 0.3 + Math.random() * 0.4,
      y: 0.2 + Math.random() * 0.4,
      w: 0.2 + Math.random() * 0.2,
      h: 0.2 + Math.random() * 0.3,
    });
  }

  result.quality = {
    brightness: 0.4 + Math.random() * 0.4,
    contrast: 0.5 + Math.random() * 0.4,
    saturation: 0.5 + Math.random() * 0.4,
    sharpness: 0.5 + Math.random() * 0.4,
  };

  return result;
}

export async function detectSilences(
  duration: number,
  threshold = 0.4
): Promise<{ start: number; end: number }[]> {
  const segments: { start: number; end: number }[] = [];
  let t = 0;
  while (t < duration) {
    const len = 2 + Math.random() * 5;
    if (Math.random() < threshold) {
      segments.push({ start: t, end: Math.min(t + 0.5 + Math.random() * 1.2, duration) });
    }
    t += len;
  }
  return segments;
}

export async function generateSubtitles(
  duration: number,
  lang: string = "ar"
): Promise<SubtitleCue[]> {
  const cues: SubtitleCue[] = [];
  const cueCount = Math.max(4, Math.floor(duration / 3));
  const cueLen = duration / cueCount;

  for (let i = 0; i < cueCount; i++) {
    const start = i * cueLen;
    const end = Math.min(start + cueLen * 0.95, duration);
    const phrase = ARABIC_SAMPLE_PHRASES[Math.floor(Math.random() * ARABIC_SAMPLE_PHRASES.length)];
    cues.push({
      id: `sub_${i}_${Date.now()}`,
      start,
      end,
      text: phrase,
      lang,
    });
  }
  return cues;
}

export async function generateTitleAndDescription(
  duration: number
): Promise<{ title: string; description: string; tags: string[] }> {
  const titles = [
    "رحلة مدهشة في عالم الذكاء الاصطناعي",
    "5 أسرار لم تسمع بها من قبل",
    "تجربتي الكاملة - النتائج صدمتني",
    "كل ما تحتاج معرفته في 5 دقائق",
    "طريقة جديدة ستغير حياتك",
  ];
  const title = titles[Math.floor(Math.random() * titles.length)];
  return {
    title,
    description: `في هذا الفيديو أستعرض تجربتي الكاملة مع الذكاء الاصطناعي وأشارككم أهم النقاط والحيل التي تعلمتها على مدار ${Math.round(duration / 60)} دقائق من العمل. لا تنسوا الاشتراك وتفعيل الجرس لمزيد من المحتوى الحصري.`,
    tags: ["ذكاء اصطناعي", "AI", "مونتاج", "تعليم", "تقنية", "تجربة"],
  };
}

export async function pickBestMusic(duration: number, mood: string): Promise<MusicTrack> {
  const candidates = MUSIC_LIBRARY.filter((m) => m.mood === mood || Math.random() < 0.3);
  const pool = candidates.length ? candidates : MUSIC_LIBRARY;
  const best = pool[Math.floor(Math.random() * pool.length)];
  const track = { ...best, duration: Math.max(best.duration, duration) };
  if (!track.url) {
    // توليد موسيقى حقيقية عبر Web Audio API (نغمة متوافقة مع المزاج).
    try {
      const url = await generateToneTrack(track);
      if (url) track.url = url;
    } catch {
      /* تُركت فارغة — سيتجاهلها المشغّل */
    }
  }
  return track;
}

/**
 * توليد نغمة موسيقية حقيقية (loop) عبر Web Audio API وتسجيلها كـ Blob URL.
 * لا يتطلب أي ملفات خارجية أو مفتاح API.
 */
export async function generateToneTrack(
  track: Pick<MusicTrack, "bpm" | "mood" | "duration">
): Promise<string> {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return "";
  const ctx = new AudioContext();
  // تأكيد استئناف السياق الصوتي (سياسة المتصفح): قد يُنشأ بلا نافذة تفاعل مباشرة.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const dest = ctx.createMediaStreamDestination();
  const recorder = new MediaRecorder(dest.stream, {
    mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm",
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // مدة النغمة: 8 ثوانٍ قابلة للتكرار تكفي لمعاينة كاملة.
  const loopSec = 8;
  const bpm = track.bpm || 90;
  const beat = 60 / bpm;
  // تتابعات كوردات حسب المزاج (أربع نوتات لكل كورد).
  const progressions: Record<string, number[][]> = {
    ملهم: [
      [261.63, 329.63, 392.0, 523.25],
      [174.61, 220.0, 261.63, 349.23],
      [196.0, 246.94, 293.66, 392.0],
      [220.0, 277.18, 329.63, 440.0],
    ],
    مريح: [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 293.66],
      [164.81, 207.65, 246.94],
    ],
    سعيد: [
      [261.63, 329.63, 392.0, 523.25],
      [293.66, 369.99, 440.0, 587.33],
      [329.63, 415.3, 493.88, 659.25],
      [261.63, 329.63, 392.0, 493.88],
    ],
    متوتر: [
      [155.56, 233.08, 311.13],
      [146.83, 220.0, 293.66],
      [138.59, 207.65, 277.18],
      [130.81, 196.0, 261.63],
    ],
    حالم: [
      [196.0, 246.94, 293.66, 392.0],
      [174.61, 220.0, 261.63, 349.23],
      [185.0, 233.08, 277.18, 369.99],
      [164.81, 207.65, 246.94, 329.63],
    ],
  };
  const chords = progressions[track.mood] || progressions["ملهم"];

  const master = ctx.createGain();
  master.gain.value = 0.16;
  master.connect(dest);

  const start = ctx.currentTime + 0.05;
  let t = start;
  for (let bar = 0; bar < loopSec / (beat * 4); bar++) {
    const chord = chords[bar % chords.length];
    chord.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8, t + 0.08);
      g.gain.setValueAtTime(0.8, t + beat * 3.4);
      g.gain.linearRampToValueAtTime(0, t + beat * 4);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + beat * 4 + 0.05);
    });
    // باس بسيط على النوتة الأولى.
    const bass = ctx.createOscillator();
    bass.type = "triangle";
    bass.frequency.value = chord[0] / 2;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.4, t);
    bg.gain.linearRampToValueAtTime(0, t + beat * 4);
    bass.connect(bg);
    bg.connect(master);
    bass.start(t);
    bass.stop(t + beat * 4 + 0.05);
    t += beat * 4;
  }

  const done = new Promise<string>((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      ctx.close().catch(() => {});
      resolve(URL.createObjectURL(blob));
    };
  });
  recorder.start();
  setTimeout(() => recorder.stop(), loopSec * 1000 + 150);
  return done;
}

export function buildThumbnailDataUrl(title: string): string {
  const canvasId = `thumb_${Math.random().toString(36).slice(2)}`;
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const grad = ctx.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, "#7c3aed");
  grad.addColorStop(1, "#06b6d4");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1280, 720);

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, 1280, 720);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 72px Tajawal, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;

  const lines = wrapText(ctx, title || "فيديو رائع", 1100);
  const startY = 360 - ((lines.length - 1) * 80) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, 640, startY + i * 80);
  });

  return canvas.toDataURL("image/jpeg", 0.85);
  void canvasId;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (ctx.measureText(test).width > maxWidth) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export async function aiVoiceover(
  text: string,
  voice: string = "ar-male-1"
): Promise<{ url: string; duration: number }> {
  const duration = Math.max(2, text.length * 0.06);
  return { url: "", duration };
}

export async function translateTranscript(
  cues: SubtitleCue[],
  target: string
): Promise<SubtitleCue[]> {
  const SAMPLE: Record<string, string[]> = {
    ar: ["مرحبا بكم", "شكرا للمشاهدة", "تابعونا"],
    en: ["Welcome everyone", "Thanks for watching", "Follow us"],
    fr: ["Bienvenue à tous", "Merci d'avoir regardé", "Suivez-nous"],
    es: ["Bienvenidos a todos", "Gracias por ver", "Síguenos"],
    tr: ["Herkese hoş geldiniz", "İzlediğiniz için teşekkürler", "Bizi takip edin"],
    de: ["Willkommen an alle", "Danke fürs Zuschauen", "Folgt uns"],
  };
  const map = SAMPLE[target] || SAMPLE.en;
  return cues.map((c, i) => ({
    ...c,
    text: map[i % map.length],
    lang: target,
  }));
}
