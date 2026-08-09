import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface SpeechSpan {
  start: number;
  end: number;
}

interface DuckEvent {
  start: number;
  end: number;
  gainDb: number; // مقدار الخفض (سالب = خفض)
  rampIn: number; // مدة النزول (ثوانٍ)
  rampOut: number; // مدة الصعود (ثوانٍ)
}

/**
 * خفض الموسيقى تحت الكلام (Ducking): يقرأ نطاقات الكلام (من الترجمة أو
 * التفريغ) ويحوّلها إلى أحداث خفض تلقائية لمسار الموسيقى — لا يلمس الصوت
 * الأصلي، بل ينتج مواصفة يطبّقها الرندر (sidechain/volume automation).
 * التدهور الأنيق: بلا نطاقات كلام → قائمة فارغة.
 */
export class MusicDuckingSkill extends BaseSkill {
  readonly name = "MusicDuckingSkill";
  readonly description = "خفض مستوى الموسيقى تلقائياً تحت الكلام (Ducking).";
  readonly category: SkillCategory = "audio";
  readonly inputSpec = {
    captions: "{start,end}[]?",
    words: "{start,end}[]?",
    musicVolume: "number?",
  };
  readonly outputSpec = { duckEvents: "DuckEvent[]", musicVolume: "number" };
  protected readonly defaultConfig = {
    gainDb: -6,
    rampIn: 0.15,
    rampOut: 0.4,
    pad: 0.12,
    minSpan: 0.3,
  };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const captions =
      (input.captions as SpeechSpan[] | undefined) ?? [];
    const words = (input.words as SpeechSpan[] | undefined) ?? [];
    const gainDb = this.cfg("gainDb", -6);
    const rampIn = this.cfg("rampIn", 0.15);
    const rampOut = this.cfg("rampOut", 0.4);
    const pad = this.cfg("pad", 0.12);
    const minSpan = this.cfg("minSpan", 0.3);

    // مصدر الكلام: كلمات Whisper (أدق) ثم أسطر الترجمة كبديل.
    const source: SpeechSpan[] =
      words.length > 0 ? words : captions;
    if (source.length === 0) {
      this.log("info", "لا نطاقات كلام — بلا Ducking (تدهور أنيق)");
      return { duckEvents: [], musicVolume: 1 };
    }

    // دمج النطاقات المتقاربة (تسامح الفجوة = ضعف الـ pad تقريباً).
    const spans: SpeechSpan[] = source
      .map((s) => ({ start: s.start, end: s.end }))
      .sort((a, b) => a.start - b.start);
    const merged: SpeechSpan[] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s.start - last.end <= pad * 2) {
        last.end = Math.max(last.end, s.end);
      } else {
        merged.push({ ...s });
      }
    }

    const duckEvents: DuckEvent[] = merged
      .filter((s) => s.end - s.start >= minSpan)
      .map((s) => ({
        start: +Math.max(0, s.start - pad).toFixed(2),
        end: +(s.end + pad).toFixed(2),
        gainDb,
        rampIn,
        rampOut,
      }));

    this.log(
      "info",
      `خفض الموسيقى ${gainDb}dB تحت ${merged.length} نطاق كلام (${duckEvents.length} حدث)`
    );
    return { duckEvents, musicVolume: 1 };
  }
}
