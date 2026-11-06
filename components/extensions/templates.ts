// قوالب بداية سريعة تعمل فوراً (كلها صالحة التحقق على المنصة الحالية).
import type { Kind } from "./types";

export interface Template { key: string; kind: Kind; title: string; blurb: string; pkg: { manifest: Record<string, unknown>; files: Record<string, string> } }

const textIn = { type: "object", properties: { text: { type: "string", maxLength: 2000, description: "النص" } }, required: ["text"] };

export const TEMPLATES: Template[] = [
  {
    key: "native", kind: "skill", title: "مهارة أصلية (إحصاءات نص)", blurb: "حساب محلي حتمي عبر إدخال TypeScript مسجّل (text_stats).",
    pkg: {
      manifest: {
        kind: "skill", id: "text_stats_demo", version: "1.0.0", name: "إحصاءات النص", description: "يحسب الكلمات والحروف ومدة النطق التقديرية.", category: "text",
        tags: ["نص", "تجريبي"], author: "", stability: "experimental", permissions: [], dependencies: { native: ["text_stats"] },
        input: textIn,
        output: { type: "object", properties: { words: { type: "integer" }, characters: { type: "integer" }, estimatedSpeechSeconds: { type: "number" } } },
        execution: { type: "native", entry: "text_stats" },
      },
      files: {},
    },
  },
  {
    key: "prompt", kind: "skill", title: "مهارة تعليمات (نموذج)", blurb: "تعليمات تُرسل لنموذج المحادثة — الناتج يُوسم «نموذج ذكاء اصطناعي» وليس تحليل وسائط.",
    pkg: {
      manifest: {
        kind: "skill", id: "tagline_writer", version: "1.0.0", name: "كاتب شعارات", description: "يقترح شعاراً قصيراً لموضوع الفيديو.", category: "text", tags: ["نص", "ذكاء"],
        author: "", stability: "experimental", permissions: ["ai.invoke"],
        input: { type: "object", properties: { topic: { type: "string", maxLength: 200, description: "موضوع الفيديو" } }, required: ["topic"] },
        output: { type: "object", properties: { tagline: { type: "string" } }, required: ["tagline"] },
        execution: { type: "prompt", instructionsFile: "instructions.md", temperature: 0.4, maxTokens: 256 },
      },
      files: { "instructions.md": "اكتب شعاراً عربياً قصيراً وجذاباً (أقل من 8 كلمات) لموضوع الفيديو المعطى.\nأجب بالشكل: {\"tagline\": \"...\"}" },
    },
  },
  {
    key: "workflow", kind: "skill", title: "مهارة مسار عمل", blurb: "تركّب إجراءات/مهارات مدمجة بخطوات متسلسلة (هنا: عرض المشاريع).",
    pkg: {
      manifest: {
        kind: "skill", id: "projects_overview", version: "1.0.0", name: "نظرة على المشاريع", description: "مسار عمل يعرض مشاريع مساحة العمل عبر إجراء معتمد.", category: "utility",
        tags: ["مسار"], author: "", stability: "experimental", permissions: ["project.read"], dependencies: { actions: ["project.list"] },
        input: { type: "object", properties: {} },
        execution: { type: "workflow", steps: [{ use: "action:project.list", with: {} }] },
      },
      files: {},
    },
  },
  {
    key: "tool", kind: "tool", title: "أداة إعلانية (عرض المشاريع)", blurb: "تستدعي إجراءً معتمداً من السجل — بلا شيفرة ولا shell.",
    pkg: {
      manifest: {
        kind: "tool", id: "my_projects", version: "1.0.0", name: "مشاريعي", description: "يعرض مشاريع مساحة العمل.", category: "utility", tags: ["مشاريع"],
        author: "", stability: "experimental", permissions: ["project.read"], dependencies: { actions: ["project.list"] },
        input: { type: "object", properties: {} },
        execution: { type: "declarative", action: "project.list", args: {} },
      },
      files: {},
    },
  },
];
