import { BaseSkill } from "../BaseSkill";
import { MediaDocument, SkillCategory, SkillContext } from "../types";

interface Caption {
  start: number;
  end: number;
  text: string;
  style?: Record<string, unknown>;
}

export class SubtitleTranslationSkill extends BaseSkill {
  readonly name = "SubtitleTranslationSkill";
  readonly description = "ترجمة الترجمة (Subtitles) إلى لغة أخرى.";
  readonly category: SkillCategory = "text";
  readonly inputSpec = { captions: "Caption[]", targetLanguage: "string" };
  readonly outputSpec = { translatedCaptions: "Caption[]", targetLanguage: "string" };
  protected readonly defaultConfig = {
    targetLanguage: "en",
    endpoint: "/api/ai/translate",
  };

  protected async execute(input: MediaDocument, ctx: SkillContext) {
    const captions = (input.captions as Caption[] | undefined) ?? [];
    const target =
      (input.targetLanguage as string) || this.cfg("targetLanguage", "en");

    const api = await this.callEndpoint<{ translations?: string[] }>(
      this.cfg("endpoint", "/api/ai/translate"),
      { texts: captions.map((c) => c.text), target },
      ctx
    );

    const translatedCaptions: Caption[] = captions.map((c, i) => ({
      ...c,
      text: api?.translations?.[i] ?? `[${target}] ${c.text}`,
    }));
    this.log(
      "info",
      `${api?.translations ? "API" : "heuristic"}: ترجمة ${translatedCaptions.length} سطر إلى ${target}`
    );
    return { translatedCaptions, targetLanguage: target };
  }
}
