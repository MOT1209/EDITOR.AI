import { apiConfig, apiFetch } from "@/lib/api-config";

let _latestTranscript = "";

export function setLatestTranscript(t: string) {
  _latestTranscript = t;
}

export function getLatestTranscript(): string {
  return _latestTranscript;
}

export function hasApiKey(): boolean {
  return !!apiConfig.opencodeKey;
}

export function hasHfToken(): boolean {
  return !!apiConfig.hfToken;
}

export async function captureFrame(
  videoUrl: string,
  seekTime = 0
): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.src = videoUrl;
    video.currentTime = seekTime;
    video.onloadeddata = () => {
      video.currentTime = seekTime;
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        canvas.getContext("2d")!.drawImage(video, 0, 0);
        const b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
        resolve(b64);
      } catch {
        resolve(null);
      } finally {
        video.remove();
      }
    };
    video.onerror = () => {
      resolve(null);
      video.remove();
    };
  });
}

function getMimeType(): string {
  const types = ["video/webm;codecs=opus", "video/webm", "audio/webm;codecs=opus", "audio/mp4"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

export async function extractAudio(
  videoUrl: string,
  maxDuration = 120
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = false;
    video.src = videoUrl;
    video.currentTime = 0;

    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const source = ctx.createMediaElementSource(video);
    source.connect(dest);
    source.connect(ctx.destination);

    const mime = getMimeType();
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(dest.stream, { mimeType: mime });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      video.remove();
      ctx.close();
      resolve(blob);
    };

    const dur = Math.min(
      video.duration || maxDuration,
      maxDuration
    );

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      video.pause();
      recorder.stop();
    }, dur * 1000 + 2000);

    recorder.start();
    video.play().catch(() => {});

    video.onended = () => {
      if (!timedOut) {
        clearTimeout(timeout);
        recorder.stop();
      }
    };

    video.onerror = () => {
      clearTimeout(timeout);
      recorder.stop();
      resolve(null);
    };
  });
}

export interface AnalyzeResult {
  scenes: { start: number; end: number; score: number }[];
  highlights: { start: number; end: number; reason: string }[];
  quality: { brightness: number; contrast: number; saturation: number; sharpness: number };
}

export async function analyzeVideo(
  videoUrl: string,
  duration: number
): Promise<AnalyzeResult> {
  const frame = await captureFrame(videoUrl, Math.min(1, duration * 0.1));
  return apiFetch("/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duration, frameBase64: frame || undefined }),
  }).then((r) => r.json());
}

export interface SubtitleResult {
  cues: {
    id: string;
    start: number;
    end: number;
    text: string;
    lang: string;
  }[];
  transcript?: string;
}

export async function generateSubtitles(
  videoFile: File | null,
  videoUrl: string,
  duration: number,
  lang: string
): Promise<SubtitleResult> {
  if (videoFile) {
    const form = new FormData();
    form.append("audio", videoFile, videoFile.name);
    form.append("language", lang);
    try {
      const res = await apiFetch("/api/ai/transcribe", {
        method: "POST",
        body: form,
      }).then((r) => r.json());
      if (res.segments && res.segments.length > 0) {
        const cues = res.segments.map(
          (s: { start: number; end: number; text: string }, i: number) => ({
            id: `sub_${i}_${Date.now()}`,
            start: s.start,
            end: s.end,
            text: s.text,
            lang,
          })
        );
        _latestTranscript = res.text || cues.map((c: { text: string }) => c.text).join(" ");
        return { cues, transcript: _latestTranscript };
      }
    } catch {
      /* fall through to mock */
    }
  }
  const res = await apiFetch("/api/ai/subtitles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duration, lang }),
  }).then((r) => r.json());
  _latestTranscript = (res.cues || [])
    .map((c: { text: string }) => c.text)
    .join(" ");
  return { cues: res.cues || [], transcript: _latestTranscript };
}

export interface MetadataResult {
  title: string;
  description: string;
  tags: string[];
}

export async function generateMetadata(
  duration: number,
  transcript?: string
): Promise<MetadataResult> {
  const body: Record<string, unknown> = { duration };
  if (transcript) body.transcript = transcript;
  return apiFetch("/api/ai/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

const PHRASE_MAP: Record<string, string[]> = {
  en: ["Welcome", "Thanks for watching", "Follow us", "Subscribe"],
  fr: ["Bienvenue", "Merci d'avoir regardé", "Suivez-nous", "Abonnez-vous"],
  es: ["Bienvenidos", "Gracias por ver", "Síguenos", "Suscríbete"],
  tr: ["Hoş geldiniz", "İzlediğiniz için teşekkürler", "Bizi takip edin", "Abone olun"],
  de: ["Willkommen", "Danke fürs Zuschauen", "Folgt uns", "Abonnieren"],
};

export interface TranslateResult {
  translated: string[];
  /** true عندما تُستخدم خريطة العبارات الجاهزة بدل ترجمة حقيقية (لا يوجد مفتاح API). */
  fallback: boolean;
}

export async function translateTexts(
  texts: string[],
  targetLang: string
): Promise<TranslateResult> {
  try {
    const unique = [...new Set(texts.filter((t) => t.trim()))];
    if (unique.length === 0) return { translated: texts, fallback: false };
    const res = await apiFetch("/api/ai/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: unique, targetLang }),
    }).then((r) => r.json());
    if (res.translated && res.translated.length > 0) {
      const map = new Map<string, string>();
      unique.forEach((orig, i) => {
        map.set(orig, res.translated[i] || orig);
      });
      return { translated: texts.map((t) => map.get(t) || t), fallback: false };
    }
    // المسار نجح لكنه لم يعيد ترجمات صالحة → ارجع للخريطة مع إشارة fallback.
    const list = PHRASE_MAP[targetLang] || PHRASE_MAP.en;
    return { translated: texts.map((_, i) => list[i % list.length]), fallback: true };
  } catch {
    // فشل الاتصال أو عدم وجود مفتاح → خريطة عبارات مع إشارة fallback واضحة.
    const list = PHRASE_MAP[targetLang] || PHRASE_MAP.en;
    return { translated: texts.map((_, i) => list[i % list.length]), fallback: true };
  }
}

export function mockProgress(
  steps: number,
  delay: number,
  update: (p: number, msg?: string) => void,
  label: string
): Promise<void> {
  const run = async () => {
    for (let i = 0; i < steps; i++) {
      await new Promise((r) => setTimeout(r, delay));
      update(((i + 1) / steps) * 100, `${label} ${i + 1}/${steps}`);
    }
  };
  return run();
}
