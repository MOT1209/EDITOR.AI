// رفع صوت التايملاين (blob:/data:/http) كأصول على الخادم قبل التصدير (T-13) كي يدخل المخرَج فعلاً.
import { apiFetch } from "@/lib/api-config";
import { isAudioRef } from "@/lib/engine/export-guard";
import type { ProjectState } from "@/lib/types";

const cache = new Map<string, string>(); // url → ref (يتفادى إعادة الرفع في كل تصدير)

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/ogg": "ogg", "audio/webm": "webm", "video/webm": "webm", "audio/mp4": "m4a", "audio/aac": "aac", "audio/flac": "flac",
};

async function uploadOne(url: string, name: string): Promise<string | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  try {
    const blob = await fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))));
    const ext = EXT_BY_MIME[blob.type.split(";")[0]] ?? "webm";
    const form = new FormData();
    form.append("file", new File([blob], `${(name || "audio").replace(/[^\w.-]+/g, "_")}.${ext}`, { type: blob.type || "audio/webm" }));
    const res = await apiFetch("/api/assets/audio", { method: "POST", body: form });
    if (!res.ok) return null;
    const data = (await res.json()) as { ref?: string };
    if (!isAudioRef(data.ref)) return null;
    cache.set(url, data.ref);
    return data.ref;
  } catch {
    return null;
  }
}

/** يعيد نسخة من المشروع حيث لكل مقطع صوت قابل للرفع `ref`؛ failed = أسماء ما تعذّر رفعه. */
export async function ensureAudioRefs(project: ProjectState): Promise<{ project: ProjectState; failed: string[] }> {
  const failed: string[] = [];
  const audioClips = await Promise.all(
    project.audioClips.map(async (a) => {
      if (isAudioRef(a.ref)) return a;
      const ref = await uploadOne(a.url, a.name || a.id);
      if (!ref) {
        failed.push(a.name || a.id);
        return a;
      }
      return { ...a, ref };
    })
  );
  return { project: { ...project, audioClips }, failed };
}
