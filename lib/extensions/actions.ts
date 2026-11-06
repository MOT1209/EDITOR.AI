// ====================================================================
// سجل الإجراءات المعتمدة (Action Registry) — الحد الأمني للأدوات الإعلانية.
//
// أداة/مهارة إعلانية لا تستطيع تنفيذ إلا إجراءً مسجَّلاً هنا. كل إجراء:
//   - مخطط مدخلات صارم (يُتحقق منه قبل التنفيذ)،
//   - صلاحيات مطلوبة (يجب أن يعلنها البيان ويمنحها المالك)،
//   - خطورة: read | write (موافقة) | costly (موافقة + ضابط تكلفة)،
//   - مصدر النتيجة (provenance) صادق.
// لا يوجد إجراء يقبل أمر shell أو وسائط FFmpeg أو مسار ملف أو عنوان شبكة من المدخلات.
// ====================================================================
import { analyzeScenes, detectBeats, detectSilence, probeMedia } from "@/lib/engine/media";
import { buildSkillDocument } from "@/lib/engine/skill-doc";
import { assetPath, findAsset, getProject, listProjects, mutateProject, primaryVideoAsset } from "@/lib/engine/store";
import { addTextOverlay, summarizeTimeline } from "@/lib/engine/timeline";
import { EngineError } from "@/lib/engine/errors";
import { getJob, revalidateJob, startRender, waitForJob, type RenderJob } from "@/lib/engine/jobs";
import { buildRenderPlan, needsCompositor } from "@/lib/engine/render-plan";
import { buildSourceMap } from "@/lib/server/render-sources";
import { buildSkillManager } from "@/lib/skills";
import { skillProvenance, type SkillProvenance } from "@/lib/skills/provenance";
import type { Capability, Permission } from "./manifest";
import type { ObjectSchema } from "./schema";

export type Provenance = SkillProvenance | "ai-model";
export type Risk = "read" | "write" | "costly";

export interface ActionContext {
  signal?: AbortSignal;
}

export interface ActionOutcome {
  result: unknown;
  provenance: Provenance;
  warnings?: string[];
}

export interface ActionDef {
  id: string;
  title: string;
  description: string;
  permissions: Permission[];
  /** قدرات المضيف التي يستلزمها الإجراء (تُفرض على الخادم قبل التشغيل). */
  capabilities?: Capability[];
  risk: Risk;
  input: ObjectSchema;
  run(args: Record<string, unknown>, ctx: ActionContext): Promise<ActionOutcome>;
}

const ID = { type: "string", maxLength: 80, minLength: 1, description: "معرّف (أحرف/أرقام/_/-)" } as const;
const str = (a: Record<string, unknown>, k: string) => a[k] as string;
const optNum = (a: Record<string, unknown>, k: string) => (typeof a[k] === "number" ? (a[k] as number) : undefined);

async function resolveAsset(a: Record<string, unknown>) {
  const pid = str(a, "projectId");
  const p = await getProject(pid);
  const asset = typeof a.assetId === "string" && a.assetId ? findAsset(p, a.assetId) : primaryVideoAsset(p);
  return { pid, asset, file: assetPath(pid, asset) };
}

const ACTIONS: ActionDef[] = [
  {
    id: "project.list",
    title: "عرض المشاريع",
    description: "قائمة مشاريع مساحة العمل.",
    permissions: ["project.read"],
    risk: "read",
    input: { type: "object", properties: {} },
    async run() {
      return { result: { projects: await listProjects() }, provenance: "computed" };
    },
  },
  {
    id: "project.timeline",
    title: "ملخص التايملاين",
    description: "المسارات والمقاطع والمدة الناتجة.",
    permissions: ["project.read"],
    risk: "read",
    input: { type: "object", properties: { projectId: ID }, required: ["projectId"] },
    async run(a) {
      return { result: summarizeTimeline(await getProject(str(a, "projectId"))), provenance: "computed" };
    },
  },
  {
    id: "media.probe",
    capabilities: ["ffmpeg"],
    title: "فحص وسائط",
    description: "ffprobe حقيقي لأصل المشروع (المدة، الأبعاد، المسارات).",
    permissions: ["media.read"],
    risk: "read",
    input: { type: "object", properties: { projectId: ID, assetId: { ...ID, description: "افتراضي: الفيديو الأساسي" } }, required: ["projectId"] },
    async run(a, ctx) {
      const { file } = await resolveAsset(a);
      return { result: await probeMedia(file, ctx.signal), provenance: "real-analysis" };
    },
  },
  {
    id: "analysis.silence",
    capabilities: ["ffmpeg"],
    title: "كشف الصمت",
    description: "silencedetect حقيقي من FFmpeg.",
    permissions: ["media.read"],
    risk: "read",
    input: {
      type: "object",
      properties: { projectId: ID, assetId: ID, noiseDb: { type: "number", minimum: -90, maximum: 0 }, minDurationSeconds: { type: "number", minimum: 0.1, maximum: 30 } },
      required: ["projectId"],
    },
    async run(a, ctx) {
      const { asset, file } = await resolveAsset(a);
      const silences = await detectSilence(file, { noiseDb: optNum(a, "noiseDb"), minDurationSeconds: optNum(a, "minDurationSeconds"), durationSeconds: asset.duration, signal: ctx.signal });
      return { result: { assetId: asset.id, silences }, provenance: "real-analysis" };
    },
  },
  {
    id: "analysis.scenes",
    capabilities: ["ffmpeg"],
    title: "كشف المشاهد",
    description: "تغيّرات المشهد عبر مرشح select(scene) الحقيقي.",
    permissions: ["media.read"],
    risk: "read",
    input: { type: "object", properties: { projectId: ID, assetId: ID, threshold: { type: "number", minimum: 0.05, maximum: 0.95 } }, required: ["projectId"] },
    async run(a, ctx) {
      const { asset, file } = await resolveAsset(a);
      const r = await analyzeScenes(file, asset.duration, { threshold: optNum(a, "threshold"), signal: ctx.signal });
      return { result: { assetId: asset.id, ...r }, provenance: "real-analysis" };
    },
  },
  {
    id: "analysis.beats",
    capabilities: ["ffmpeg"],
    title: "كشف الإيقاع",
    description: "بدايات صوتية وBPM تقديري من طاقة الصوت (حساب بسيط، راجع confidence).",
    permissions: ["media.read"],
    risk: "read",
    input: { type: "object", properties: { projectId: ID, assetId: ID, maxSeconds: { type: "number", minimum: 5, maximum: 1800 } }, required: ["projectId"] },
    async run(a, ctx) {
      const { asset, file } = await resolveAsset(a);
      const r = await detectBeats(file, { maxSeconds: optNum(a, "maxSeconds"), signal: ctx.signal });
      return { result: { assetId: asset.id, ...r }, provenance: "real-analysis" };
    },
  },
  {
    id: "skills.run",
    title: "تشغيل مهارة مدمجة",
    description: "يشغّل مهارة من الكتالوج المدمج على مستند مبني من المشروع. provenance يعكس مصدر النتيجة الفعلي للمهارة.",
    permissions: ["skills.run"],
    risk: "read",
    input: {
      type: "object",
      properties: {
        skill: { type: "string", maxLength: 60, minLength: 3 },
        projectId: ID,
        useRealAnalysis: { type: "boolean", default: true },
        topic: { type: "string", maxLength: 500 },
      },
      required: ["skill"],
    },
    async run(a, ctx) {
      const name = str(a, "skill");
      const m = buildSkillManager();
      if (name.startsWith("ext_") || !m.has(name)) throw new EngineError("NOT_FOUND", `مهارة مدمجة غير موجودة: ${name}`);
      const extra: Record<string, unknown> = typeof a.topic === "string" && a.topic ? { topic: a.topic } : {};
      const { doc, notes } = await buildSkillDocument(typeof a.projectId === "string" ? a.projectId : undefined, a.useRealAnalysis !== false, extra, ctx.signal);
      const res = await m.runSkill(name, doc, m.createContext(doc, { signal: ctx.signal }));
      if (!res.ok) throw new EngineError("EXECUTION_FAILED", `فشلت المهارة ${name}: ${res.error ?? "؟"}`);
      const provenance = skillProvenance(name, res.logs);
      return { result: res.output ?? {}, provenance, warnings: provenance === "simulated" ? [...notes, "نتيجة محاكاة/استدلالية — ليست تحليلاً حقيقياً"] : notes };
    },
  },
  {
    id: "timeline.add_text",
    title: "إضافة نص فوق الفيديو",
    description: "يضيف طبقة نص إلى المشروع (قابل للتراجع عبر undo_edit).",
    permissions: ["project.write"],
    risk: "write",
    input: {
      type: "object",
      properties: {
        projectId: ID,
        text: { type: "string", minLength: 1, maxLength: 500 },
        start: { type: "number", minimum: 0, maximum: 36000 },
        end: { type: "number", minimum: 0, maximum: 36000 },
      },
      required: ["projectId", "text", "start", "end"],
    },
    async run(a) {
      const r = await mutateProject(str(a, "projectId"), "add_text_overlay", `نص «${str(a, "text").slice(0, 30)}» (إضافة)`, (p) => {
        const o = addTextOverlay(p, { text: str(a, "text"), start: a.start as number, end: a.end as number });
        return { project: o.project, result: { overlayId: o.overlayId } };
      });
      return { result: { historyId: r.historyId, ...r.result }, provenance: "computed" };
    },
  },
];

/** ملخص مهمة بلا مسارات خارج مساحة العمل. */
function jobSummary(job: RenderJob) {
  const { outputFile, ...rest } = job;
  return { ...rest, ...(outputFile && (job.status === "completed" || job.status === "failed_validation") ? { outputPath: `projects/${job.projectId}/renders/${job.id}/${outputFile}` } : {}) };
}

ACTIONS.push(
  {
    id: "render.export",
    capabilities: ["ffmpeg"],
    title: "تصدير الفيديو",
    description: "يبدأ تصديراً كاملاً بإعدادات المشروع (FFmpeg حقيقي + مراجعة ffprobe). مكلف زمنياً. النجاح = status=completed فقط.",
    permissions: ["render.export"],
    risk: "costly",
    input: { type: "object", properties: { projectId: ID, waitSeconds: { type: "integer", minimum: 0, maximum: 110, default: 0, description: "0 = ابدأ وعُد فوراً (تابع بـ render.status)" } }, required: ["projectId"] },
    async run(a) {
      const pid = str(a, "projectId");
      let job = await startRender(pid, { kind: "export" });
      const wait = optNum(a, "waitSeconds") ?? 0;
      if (wait > 0) job = await waitForJob(pid, job.id, Math.min(wait, 110) * 1000);
      return { result: jobSummary(job), provenance: job.review ? "real-analysis" : "computed", warnings: job.status === "completed" || !wait ? [] : [`الحالة: ${job.status} — النجاح لا يُعلن إلا عند completed`] };
    },
  },
  {
    id: "render.status",
    title: "حالة التصدير",
    description: "حالة مهمة رندر ونتيجة مراجعة ffprobe.",
    permissions: ["project.read"],
    risk: "read",
    input: { type: "object", properties: { projectId: ID, jobId: ID }, required: ["projectId", "jobId"] },
    async run(a) {
      const job = await getJob(str(a, "projectId"), str(a, "jobId"));
      return { result: jobSummary(job), provenance: job.review ? "real-analysis" : "computed" };
    },
  },
  {
    id: "render.review",
    title: "مراجعة جودة المخرَج",
    description: "يعيد فحص ملف رندر مكتمل بـ ffprobe/blackdetect/volumedetect (ملف موجود، مدة، أبعاد، ليس أسود، صوت غير صامت). نتيجة حقيقية لا تقديرية.",
    permissions: ["media.read"],
    capabilities: ["ffmpeg"],
    risk: "read",
    input: { type: "object", properties: { projectId: ID, jobId: ID }, required: ["projectId", "jobId"] },
    async run(a) {
      const job = await revalidateJob(str(a, "projectId"), str(a, "jobId"));
      return { result: { ...jobSummary(job), review: job.review }, provenance: "real-analysis", warnings: job.review?.passed ? [] : (job.review?.issues ?? []) };
    },
  },
  {
    id: "timeline.preflight",
    title: "فحص ما قبل الرندر",
    description: "يبني خطة الرندر المتحقَّقة للمشروع ويعيد المشاكل (مصدر مفقود، تداخل مقاطع، صوت بلا ملف، تجاوز المصدر) دون رندر.",
    permissions: ["media.read"],
    capabilities: ["ffmpeg"],
    risk: "read",
    input: { type: "object", properties: { projectId: ID }, required: ["projectId"] },
    async run(a) {
      const project = await getProject(str(a, "projectId"));
      const { map, unresolved } = await buildSourceMap(project, {});
      const plan = buildRenderPlan(project, map);
      return {
        result: {
          ok: plan.ok && unresolved.length === 0,
          engine: needsCompositor(project, map) ? "compositor" : "legacy",
          durationSeconds: plan.duration,
          layers: plan.layers.length,
          audioLayers: plan.audio.length,
          unresolvedAssets: unresolved,
          issues: plan.issues,
        },
        provenance: "computed",
        warnings: plan.issues.filter((i) => i.severity === "warning").map((i) => i.message),
      };
    },
  }
);

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export function getAction(id: string): ActionDef | undefined {
  return BY_ID.get(id);
}

export function listActions(): Array<Omit<ActionDef, "run">> {
  return ACTIONS.map(({ run: _r, ...rest }) => rest);
}
