import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface TextOverlay {
  text: string;
  time: number;
  duration: number;
  position: "top" | "center" | "bottom";
  size: "small" | "medium" | "large";
  style: string;
}

/**
 * نصوص Hook عند اللحظات المميزة: يضع نصاً كبيراً لافتاً (السطر الأول من
 * العنوان أو عنوان مخصص) عند أقوى Highlight. التدهور الأنيق: بلا Highlights
 * أو عنوان يكتفي بإطار العنوان في البداية.
 */
export class TextOverlaySkill extends BaseSkill {
  readonly name = "TextOverlaySkill";
  readonly description = "إضافة نصوص Hook بارزة (عنوان/جملة لافتة) عند اللحظات المميزة.";
  readonly category: SkillCategory = "text";
  readonly inputSpec = {
    highlights: "Highlight[]",
    title: "string?",
    description: "string?",
    duration: "number",
  };
  readonly outputSpec = { textOverlays: "TextOverlay[]" };
  protected readonly defaultConfig = {
    duration: 1.6,
    hookText: "", // نص مخصص للـ Hook؛ فارغ = يُشتق من العنوان
    introDuration: 1.4,
  };

  protected async execute(input: MediaDocument, _ctx: SkillContext) {
    const duration = input.duration ?? 30;
    const highlights =
      (input.highlights as Array<{ time: number; score: number }> | undefined) ?? [];
    const title = (input.title as string | undefined)?.trim();
    const description = (input.description as string | undefined)?.trim();
    const overlayDur = this.cfg("duration", 1.6);
    const hookText = this.cfg("hookText", "") as string;
    const introDur = this.cfg("introDuration", 1.4);

    const overlays: TextOverlay[] = [];

    // إطار افتتاحي: العنوان في أول المقطع.
    if (title) {
      overlays.push({
        text: title,
        time: 0.4,
        duration: introDur,
        position: "center",
        size: "large",
        style: "bold",
      });
    }

    // نص الـ Hook عند أقوى لحظة مميزة.
    const best = highlights.length
      ? highlights.reduce((a, b) => (b.score > a.score ? b : a))
      : undefined;
    if (best && best.time > introDur) {
      const text =
        hookText ||
        (description ? description.split(/[.،!؟\n]/)[0] : undefined) ||
        (title ? title : "") ||
        "🔥";
      if (text.trim()) {
        overlays.push({
          text: text.trim().slice(0, 60),
          time: +Math.max(0.2, best.time - 0.2).toFixed(2),
          duration: overlayDur,
          position: "center",
          size: "large",
          style: "highlight",
        });
      }
    }

    this.log("info", `أضاف ${overlays.length} نصاً (${overlays.filter((o) => o.style === "highlight").length} Hook)`);
    return { textOverlays: overlays };
  }
}
