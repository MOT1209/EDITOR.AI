import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Span {
  start: number;
  end: number;
}
interface CaptionLike {
  start: number;
  end: number;
  text: string;
}
export interface QcCheck {
  id: string;
  status: "pass" | "warn" | "fail" | "skipped";
  message: string;
}

/**
 * مراقبة جودة على المستند المشترك (حساب حتمي — provenance=computed، جودته من جودة المدخلات).
 * لا تفحص ملفاً: فحص الملف المرندر = الإجراء render.review / reviewRender (ffprobe).
 * فحوصها بلا مصدر بيانات تُوسم skipped صراحةً بدل افتراض نجاح.
 * سرعة القراءة 21 حرفاً/ثانية = إرشاد شائع للترجمة (ليس معياراً ملزماً).
 */
export class QualityControlSkill extends BaseSkill {
  readonly name = "QualityControlSkill";
  readonly description = "ضبط الجودة: يفحص المدة والترجمات (كثافة/تداخل) ونسبة الصمت وملاءمة المقاس للمنصة ويعيد حكماً صريحاً مع فحوص تفصيلية.";
  readonly category: SkillCategory = "analysis";
  readonly inputSpec = { duration: "number", captions: "{start,end,text}[] (اختياري)", silences: "{start,end}[] (اختياري)", aspect: "string (اختياري)", platform: "string (اختياري)" };
  readonly outputSpec = { qc: "{ passed, score, checks[] }" };
  protected readonly defaultConfig = { maxCharsPerSecond: 21, maxSilenceRatio: 0.35 };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const checks: QcCheck[] = [];
    const duration = Number(input.duration) || 0;
    checks.push(duration > 0 ? { id: "duration", status: "pass", message: `المدة ${duration}s` } : { id: "duration", status: "fail", message: "المدة صفر أو غير معروفة" });

    const caps = (Array.isArray(input.captions) ? (input.captions as CaptionLike[]) : Array.isArray(input.subtitles) ? (input.subtitles as CaptionLike[]) : null);
    if (!caps) checks.push({ id: "captions", status: "skipped", message: "لا ترجمات في المستند — لم تُفحص" });
    else {
      const maxCps = this.cfg("maxCharsPerSecond", 21);
      const dense = caps.filter((c) => c.end > c.start && c.text.length / (c.end - c.start) > maxCps);
      const sorted = caps.slice().sort((a, b) => a.start - b.start);
      let overlaps = 0;
      for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end - 1e-6) overlaps++;
      const bad = caps.filter((c) => !(c.end > c.start)).length;
      checks.push(
        bad || overlaps
          ? { id: "captions", status: "fail", message: `${bad} ترجمة بمدة غير صالحة، ${overlaps} تداخل` }
          : dense.length
            ? { id: "captions", status: "warn", message: `${dense.length} ترجمة أسرع من ${maxCps} حرفاً/ثانية (صعبة القراءة)` }
            : { id: "captions", status: "pass", message: `${caps.length} ترجمة سليمة` }
      );
    }

    const silences = Array.isArray(input.silences) ? (input.silences as Span[]) : null;
    if (!silences || duration <= 0) checks.push({ id: "silence", status: "skipped", message: "لا تحليل صمت — لم يُفحص" });
    else {
      const total = silences.reduce((s, x) => s + Math.max(0, x.end - x.start), 0);
      const ratio = Math.min(1, total / duration);
      const max = this.cfg("maxSilenceRatio", 0.35);
      checks.push({ id: "silence", status: ratio > max ? "warn" : "pass", message: `الصمت ${(ratio * 100).toFixed(0)}% من المدة (الحد ${(max * 100).toFixed(0)}%)` });
    }

    const platform = typeof input.platform === "string" ? input.platform : "";
    const aspect = typeof input.aspect === "string" ? input.aspect : "";
    const vertical = new Set(["tiktok", "instagram", "youtube_shorts", "reels"]);
    if (!platform || !aspect) checks.push({ id: "aspect", status: "skipped", message: "المنصة أو المقاس غير محدّد" });
    else if (vertical.has(platform)) checks.push(aspect === "9:16" ? { id: "aspect", status: "pass", message: "مقاس عمودي مناسب" } : { id: "aspect", status: "warn", message: `المنصة ${platform} عمودية غالباً والمقاس ${aspect}` });
    else checks.push({ id: "aspect", status: "pass", message: `المقاس ${aspect}` });

    const failed = checks.filter((c) => c.status === "fail").length;
    const warned = checks.filter((c) => c.status === "warn").length;
    const ran = checks.filter((c) => c.status !== "skipped").length;
    const score = ran === 0 ? 0 : Math.max(0, Math.round(100 - failed * 40 - warned * 15));
    this.log("info", `ضبط الجودة: ${failed} فشل، ${warned} تحذير، ${checks.length - ran} غير مفحوص`);
    return { qc: { passed: failed === 0 && ran > 0, score, checks } };
  }
}
