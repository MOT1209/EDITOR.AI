import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

export interface ScriptSection {
  text: string;
  durationSec: number;
}

export interface GeneratedScript {
  hook: string;
  sections: ScriptSection[];
  cta: string;
}

/**
 * يكتب سكربت فيديو كامل من فكرة/موضوع نصّي — نقطة بداية لمسار
 * "إنشاء محتوى" (idea → script → storyboard)، وليس تحرير فيديو موجود.
 */
export class ScriptWriterSkill extends BaseSkill {
  readonly name = "ScriptWriterSkill";
  readonly description = "كتابة سكربت فيديو (Hook + مقاطع + CTA) من موضوع نصّي.";
  readonly category: SkillCategory = "text";
  readonly inputSpec = { topic: "string", durationSec: "number?", tone: "string?" };
  readonly outputSpec = { script: "{ hook, sections[], cta }" };
  protected readonly defaultConfig = {
    durationSec: 60,
    tone: "حماسي",
    endpoint: "/api/ai/script",
  };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const topic = (input.topic as string) || "موضوع الفيديو";
    const durationSec = (input.durationSec as number) ?? this.cfg("durationSec", 60);
    const tone = (input.tone as string) || this.cfg("tone", "حماسي");

    const api = await this.callEndpoint<{ script?: GeneratedScript }>(
      this.cfg("endpoint", "/api/ai/script"),
      { topic, durationSec, tone },
      ctx
    );

    const script: GeneratedScript =
      api?.script ?? this.fallbackScript(topic, durationSec);

    this.log(
      "info",
      `${api?.script ? "API" : "heuristic"}: سكربت لـ "${topic}" (${script.sections.length} مقطع)`
    );
    return { script };
  }

  private fallbackScript(topic: string, durationSec: number): GeneratedScript {
    const bodySec = Math.max(durationSec - 8, 10);
    return {
      hook: `لا تصدّق ما سأخبرك به عن ${topic}!`,
      sections: [
        { text: `اليوم نتحدث عن ${topic} وأهم ما يجب أن تعرفه.`, durationSec: bodySec * 0.4 },
        { text: `السبب الحقيقي وراء ${topic} قد يفاجئك.`, durationSec: bodySec * 0.6 },
      ],
      cta: "تابعنا لمزيد من المحتوى مثل هذا!",
    };
  }
}
