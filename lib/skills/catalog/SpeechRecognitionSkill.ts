import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Segment {
  id: number;
  start: number;
  end: number;
  text: string;
  lang: string;
}

export class SpeechRecognitionSkill extends BaseSkill {
  readonly name = "SpeechRecognitionSkill";
  readonly description = "تحويل الكلام إلى نص مع توقيتات (Whisper).";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = { audioBase64: "string (اختياري)", language: "string" };
  readonly outputSpec = { transcript: "{ text, segments }" };
  protected readonly defaultConfig = { language: "ar", segmentLen: 3 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const lang = (input.language as string) || this.cfg("language", "ar");
    // النسخ الحقيقي يتم عبر /api/ai/transcribe (يتطلب رفع ملف الصوت من الواجهة).
    // هنا ننتج هيكل توقيتات قابلاً للاستهلاك من Skills اللاحقة (AutoCaption...).
    const segLen = this.cfg("segmentLen", 3);
    const count = Math.max(1, Math.floor(duration / segLen));
    const segments: Segment[] = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      start: +(i * segLen).toFixed(2),
      end: +Math.min((i + 1) * segLen, duration).toFixed(2),
      text: `مقطع كلام ${i + 1}`,
      lang,
    }));
    const transcript = { text: segments.map((s) => s.text).join(" "), segments };
    this.log("info", `تم إنشاء ${segments.length} مقطع نصي (${lang})`);
    return { transcript };
  }
}
