// ====================================================================
// خادم MCP لـ MontageAI — أدوات مكتوبة الأنواع تعمل على حالة مشروع حقيقية.
//
// - كل أداة: مخطط مدخلات Zod دقيق + مخرَج مهيكل (structuredContent) + أخطاء
//   قابلة للتصرف (isError + code + hint) — لا نجاح مُختلق.
// - لا تنفيذ shell ولا وسائط FFmpeg من الوكيل: كل الأوامر تُبنى من عمليات مهيكلة.
// - حدود نظام الملفات: مساحة العمل + جذور الاستيراد فقط (lib/engine/store.ts).
// - العمليات المكلفة/المدمّرة تمر عبر الموافقة (mcp/approval.ts).
// - سجل تدقيق JSONL بلا أسرار ولا محتوى وسائط.
// ====================================================================
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { EngineError, isEngineError } from "@/lib/engine/errors";
import { analyzeScenes, detectBeats, detectSilence, probeMedia } from "@/lib/engine/media";
import { applyPlan, createPlan, getPlan, reviewPlan } from "@/lib/engine/plans";
import { ASPECTS, COLOR_FILTER_IDS, EFFECT_IDS, LIMITS } from "@/lib/engine/project-schema";
import {
  assetPath,
  auditLog,
  createProject,
  findAsset,
  getProject,
  importMedia,
  listHistory,
  listProjects,
  mediaRoots,
  mutateProject,
  primaryVideoAsset,
  redo,
  undo,
  workspaceRoot,
} from "@/lib/engine/store";
import {
  addAudioClip,
  addCaptions,
  addTextOverlay,
  applyEffect,
  deleteClip,
  moveClip,
  setClipVolume,
  splitClip,
  summarizeTimeline,
  timelineDuration,
  trimClip,
} from "@/lib/engine/timeline";
import { cancelJob, getJob, listJobs, revalidateJob, startRender, waitForJob, type RenderJob } from "@/lib/engine/jobs";
import { buildSkillManager } from "@/lib/skills";
import { skillProvenance } from "@/lib/skills/provenance";
import type { ProjectState } from "@/lib/types";
import { elicitationApprover, approvalPolicy, requireApproval, type Approver } from "./approval";

export const SERVER_NAME = "montage-ai";
export const SERVER_VERSION = "0.2.0";

// ---------------------------------------------------------------- مخططات مشتركة
const projectId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).describe("معرّف المشروع (من list_projects / create_project)");
const entityId = (what: string) => z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).describe(what);
const seconds = z.number().min(0).max(LIMITS.maxSeconds);

const errorShape = { code: z.string(), message: z.string(), hint: z.string().optional() };

/** مخرَج عام: المخططات الدقيقة لكل أداة تُعرَّف بجوارها. */
const timelineOut = {
  durationSeconds: z.number(),
  sourceDurationSeconds: z.number(),
  tracks: z.array(z.object({ id: z.string(), kind: z.string(), label: z.string(), muted: z.boolean(), locked: z.boolean(), clipCount: z.number() })),
  clips: z.array(
    z.object({
      id: z.string(),
      index: z.number(),
      trackId: z.string(),
      assetId: z.string(),
      start: z.number(),
      end: z.number(),
      inPoint: z.number(),
      outPoint: z.number(),
      speed: z.number(),
      volume: z.number(),
      colorFilter: z.string(),
    })
  ),
  subtitles: z.number(),
  textOverlays: z.number(),
  audioClips: z.number(),
  effects: z.array(z.string()),
};

const editOut = {
  projectId: z.string(),
  historyId: z.string(),
  timeline: z.object(timelineOut),
};

const jobOut = {
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(["preview", "export"]),
  status: z.string(),
  progress: z.number(),
  createdAt: z.string(),
  finishedAt: z.string().optional(),
  outputPath: z.string().optional(),
  expected: z.object({ durationSeconds: z.number(), width: z.number().optional(), height: z.number().optional(), hasAudio: z.boolean() }),
  range: z.object({ start: z.number(), end: z.number() }).optional(),
  review: z
    .object({ passed: z.boolean(), issues: z.array(z.string()), details: z.record(z.string(), z.unknown()) })
    .optional(),
  warnings: z.array(z.string()),
  error: z.string().optional(),
};


// ---------------------------------------------------------------- أدوات مساعدة
function ok<T extends Record<string, unknown>>(data: T, summary?: string): CallToolResult {
  const text = (summary ? summary + "\n" : "") + JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: text.length > 60_000 ? text.slice(0, 60_000) + "\n…(مقتطع)" : text }], structuredContent: data };
}

/**
 * نتيجة خطأ: بلا structuredContent عمداً — عملاء MCP يتحققون من structuredContent
 * مقابل outputSchema (مخطط النجاح) حتى مع isError، فيرفضون أي كائن خطأ.
 * السطر الأخير من النص JSON قابل للقراءة آلياً: {"error":{code,message,hint}}.
 */
function fail(code: string, message: string, hint?: string): CallToolResult {
  const error = { code, message, ...(hint ? { hint } : {}) };
  return {
    isError: true,
    content: [{ type: "text", text: `[${code}] ${message}${hint ? `\nتلميح: ${hint}` : ""}\n${JSON.stringify({ error })}` }],
  };
}

/** يستخرج كائن الخطأ من نتيجة أداة فاشلة (للعملاء والاختبارات). */
export function parseToolError(text: string): { code: string; message: string; hint?: string } | null {
  const last = text.trim().split("\n").pop() ?? "";
  try {
    return (JSON.parse(last) as { error: { code: string; message: string; hint?: string } }).error ?? null;
  } catch {
    return null;
  }
}

function publicJob(job: RenderJob, outputPath: string | null) {
  const { outputFile: _f, ...rest } = job;
  return { ...rest, ...(outputPath && (job.status === "completed" || job.status === "failed_validation") ? { outputPath } : {}) };
}

function capJson(value: unknown, maxChars = 40_000): unknown {
  const s = JSON.stringify(value);
  if (s === undefined || s.length <= maxChars) return value;
  return { truncated: true, preview: s.slice(0, maxChars) };
}

export interface MontageServerOptions {
  /** موافقة مخصّصة (الافتراضي: elicitation حسب MONTAGE_MCP_APPROVAL). */
  approver?: Approver;
}

export function createMontageServer(opts: MontageServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { logging: {} },
      instructions:
        "MontageAI: محرر فيديو محلي. ابدأ بـ list_projects أو create_project ثم import_media (من جذور الاستيراد المسموحة). " +
        "التعديلات قابلة للتراجع (undo_edit). الخطط (create_editing_plan) لا تغيّر المشروع حتى apply_editing_plan بموافقة المستخدم. " +
        "التصدير يُعدّ ناجحاً فقط عند status=completed (مراجعة ffprobe ناجحة).",
    }
  );
  const approver = opts.approver ?? elicitationApprover(server);

  /** يغلّف كل أداة: تحويل أخطاء المحرك، تسجيل تدقيق، وعدم تسريب استثناءات خام. */
  function tool<S extends z.ZodRawShape>(
    name: string,
    config: {
      title: string;
      description: string;
      input: S;
      output: z.ZodRawShape;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
    },
    handler: (args: z.infer<z.ZodObject<S>>, signal: AbortSignal) => Promise<CallToolResult>
  ) {
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.input,
        outputSchema: config.output,
        annotations: { openWorldHint: false, ...config.annotations },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any, extra: { signal: AbortSignal }) => {
        const started = Date.now();
        const pid = typeof args?.projectId === "string" ? args.projectId : undefined;
        try {
          const res = await handler(args, extra.signal);
          await auditLog({ tool: name, projectId: pid, ok: !res.isError, ms: Date.now() - started });
          return res;
        } catch (e) {
          const code = isEngineError(e) ? e.code : "INTERNAL";
          await auditLog({ tool: name, projectId: pid, ok: false, code, ms: Date.now() - started });
          if (isEngineError(e)) return fail(e.code, e.message, e.hint);
          return fail("INTERNAL", `خطأ غير متوقع: ${(e as Error).message?.slice(0, 500) ?? String(e)}`);
        }
      }) as never
    );
  }

  const edit = async (
    pid: string,
    op: string,
    summary: string,
    fn: (p: ProjectState) => { project: ProjectState; extra?: Record<string, unknown> }
  ) => {
    const r = await mutateProject(pid, op, summary, (p) => {
      const out = fn(p);
      return { project: out.project, result: out.extra ?? {} };
    });
    return ok({ projectId: pid, historyId: r.historyId, timeline: summarizeTimeline(r.project), ...r.result }, `✓ ${summary}`);
  };

  // ============================================================ المشاريع
  tool(
    "list_projects",
    {
      title: "عرض المشاريع",
      description: "يعرض مشاريع مساحة العمل على الخادم (ليس مشاريع localStorage في المتصفح).",
      input: {},
      output: {
        workspace: z.string(),
        projects: z.array(z.object({ id: z.string(), name: z.string(), aspect: z.string(), durationSeconds: z.number(), assets: z.number(), clips: z.number(), updatedAt: z.string() })),
      },
      annotations: { readOnlyHint: true },
    },
    async () => ok({ workspace: workspaceRoot(), projects: await listProjects() })
  );

  tool(
    "get_project",
    {
      title: "تفاصيل مشروع",
      description: "يعيد حالة المشروع الكاملة (ProjectState) كما سيصدّرها المحرّك.",
      input: { projectId },
      output: { project: z.looseObject({ id: z.string(), name: z.string() }) },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid }) => ok({ project: (await getProject(pid)) as unknown as Record<string, unknown> & { id: string; name: string } })
  );

  tool(
    "create_project",
    {
      title: "إنشاء مشروع",
      description: "ينشئ مشروعاً فارغاً في مساحة العمل. استورد فيديو بعدها عبر import_media.",
      input: {
        name: z.string().min(1).max(LIMITS.maxName),
        aspect: z.enum(ASPECTS).default("16:9").describe("نسبة المخرَج"),
        resolution: z.enum(["720p", "1080p", "4k"]).default("720p"),
        fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
      },
      output: { projectId: z.string(), name: z.string(), aspect: z.string(), resolution: z.string(), fps: z.number() },
    },
    async ({ name, aspect, resolution, fps }) => {
      const p = await createProject({ name, aspect, resolution, fps });
      return ok({ projectId: p.id, name: p.name, aspect: p.aspect, resolution: p.resolution, fps: p.fps }, "✓ أُنشئ المشروع");
    }
  );

  tool(
    "get_project_status",
    {
      title: "حالة المشروع",
      description: "ملخص: المدة، الأصول، آخر مهام الرندر، الخطط، والسجل — للتخطيط قبل التعديل.",
      input: { projectId },
      output: {
        projectId: z.string(),
        name: z.string(),
        timelineDurationSeconds: z.number(),
        assets: z.number(),
        clips: z.number(),
        subtitles: z.number(),
        undoAvailable: z.number(),
        redoAvailable: z.number(),
        recentRenders: z.array(z.object({ id: z.string(), kind: z.string(), status: z.string(), progress: z.number() })),
        approvalPolicy: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid }) => {
      const p = await getProject(pid);
      const h = await listHistory(pid);
      const jobs = (await listJobs(pid)).slice(0, 5);
      return ok({
        projectId: p.id,
        name: p.name,
        timelineDurationSeconds: timelineDuration(p),
        assets: p.assets?.length ?? 0,
        clips: p.clips.length,
        subtitles: p.subtitles.length,
        undoAvailable: h.undo.length,
        redoAvailable: h.redo.length,
        recentRenders: jobs.map((j) => ({ id: j.id, kind: j.kind, status: j.status, progress: j.progress })),
        approvalPolicy: approvalPolicy(),
      });
    }
  );

  // ============================================================ الوسائط
  tool(
    "import_media",
    {
      title: "استيراد وسيط",
      description:
        "ينسخ ملف فيديو/صوت/صورة إلى مشروع بعد التحقق (جذر مسموح، امتداد، حجم، ffprobe). أول فيديو يصبح المصدر الأساسي بمقطع كامل. " +
        "المسارات خارج جذور الاستيراد تُرفض.",
      input: {
        projectId,
        path: z.string().min(1).max(4096).describe("مسار مطلق داخل جذر مسموح، أو نسبي إلى inbox"),
        name: z.string().max(200).optional(),
      },
      output: {
        projectId: z.string(),
        asset: z.object({ id: z.string(), type: z.string(), name: z.string(), durationSeconds: z.number() }),
        clipCreated: z.boolean(),
        info: z.looseObject({ durationSeconds: z.number() }),
        allowedRoots: z.array(z.string()),
      },
    },
    async ({ projectId: pid, path: p, name }, signal) => {
      const r = await importMedia(pid, p, { name, signal });
      return ok(
        {
          projectId: pid,
          asset: { id: r.asset.id, type: r.asset.type, name: r.asset.name, durationSeconds: r.asset.duration },
          clipCreated: r.clipCreated,
          info: r.info as unknown as { durationSeconds: number },
          allowedRoots: mediaRoots(),
        },
        "✓ استُورد الوسيط"
      );
    }
  );

  tool(
    "list_media_assets",
    {
      title: "أصول المشروع",
      description: "يعرض الوسائط المستوردة في المشروع.",
      input: { projectId },
      output: {
        assets: z.array(z.object({ id: z.string(), type: z.string(), name: z.string(), durationSeconds: z.number(), primary: z.boolean(), meta: z.record(z.string(), z.union([z.string(), z.number()])) })),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid }) => {
      const p = await getProject(pid);
      const primaryId = p.assets?.find((a) => a.type === "video")?.id;
      return ok({
        assets: (p.assets ?? []).map((a) => ({ id: a.id, type: a.type, name: a.name, durationSeconds: a.duration, primary: a.id === primaryId, meta: a.meta ?? {} })),
      });
    }
  );

  tool(
    "inspect_media",
    {
      title: "فحص وسيط (ffprobe)",
      description: "بيانات وصفية حقيقية عبر ffprobe: المدة، الترميز، الأبعاد، fps، الصوت. (يغطي ما كان مقترحاً كـ get_media_metadata.)",
      input: { projectId, assetId: entityId("معرّف الأصل") },
      output: {
        assetId: z.string(),
        durationSeconds: z.number(),
        sizeBytes: z.number().nullable(),
        formatName: z.string(),
        video: z.object({ codec: z.string(), width: z.number(), height: z.number(), fps: z.number() }).nullable(),
        audio: z.object({ codec: z.string(), sampleRate: z.number(), channels: z.number() }).nullable(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid, assetId }, signal) => {
      const p = await getProject(pid);
      const info = await probeMedia(assetPath(pid, findAsset(p, assetId)), signal);
      return ok({ assetId, ...info });
    }
  );

  tool(
    "analyze_scenes",
    {
      title: "كشف المشاهد",
      description: "نقاط تغيّر المشهد الحقيقية عبر FFmpeg (select=scene). لا يعدّل المشروع.",
      input: {
        projectId,
        assetId: entityId("معرّف الأصل (افتراضي: الفيديو الأساسي)").optional(),
        threshold: z.number().min(0.05).max(0.95).default(0.3).describe("حساسية التغيّر 0..1 (أقل = مشاهد أكثر)"),
        minSceneSeconds: z.number().min(0.1).max(60).default(0.5),
      },
      output: { assetId: z.string(), cuts: z.array(z.number()), scenes: z.array(z.object({ start: z.number(), end: z.number() })), method: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid, assetId, threshold, minSceneSeconds }, signal) => {
      const p = await getProject(pid);
      const a = assetId ? findAsset(p, assetId) : primaryVideoAsset(p);
      if (a.type !== "video") throw new EngineError("UNSUPPORTED", "كشف المشاهد يتطلب أصل فيديو");
      const r = await analyzeScenes(assetPath(pid, a), a.duration, { threshold, minSceneSeconds, signal });
      return ok({ assetId: a.id, ...r, method: `ffmpeg select(scene>${threshold})` });
    }
  );

  tool(
    "detect_silence",
    {
      title: "كشف الصمت",
      description: "فترات الصمت الحقيقية عبر FFmpeg silencedetect (بزمن المصدر). لا يعدّل المشروع.",
      input: {
        projectId,
        assetId: entityId("معرّف الأصل (افتراضي: الفيديو الأساسي)").optional(),
        noiseDb: z.number().min(-90).max(0).default(-30),
        minDurationSeconds: z.number().min(0.1).max(30).default(0.5),
      },
      output: { assetId: z.string(), silences: z.array(z.object({ start: z.number(), end: z.number() })), totalSilenceSeconds: z.number() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid, assetId, noiseDb, minDurationSeconds }, signal) => {
      const p = await getProject(pid);
      const a = assetId ? findAsset(p, assetId) : primaryVideoAsset(p);
      const silences = await detectSilence(assetPath(pid, a), { noiseDb, minDurationSeconds, durationSeconds: a.duration, signal });
      const total = Math.round(silences.reduce((s, x) => s + (x.end - x.start), 0) * 1000) / 1000;
      return ok({ assetId: a.id, silences, totalSilenceSeconds: total });
    }
  );

  tool(
    "detect_beats",
    {
      title: "كشف الإيقاع",
      description: "بدايات صوتية (onsets) وتقدير BPM من طاقة الصوت الحقيقية (طريقة حسابية بسيطة — راجع confidence).",
      input: {
        projectId,
        assetId: entityId("معرّف الأصل (افتراضي: الفيديو الأساسي)").optional(),
        maxSeconds: z.number().min(5).max(1800).default(600),
      },
      output: { assetId: z.string(), method: z.string(), bpm: z.number().nullable(), confidence: z.number(), onsets: z.array(z.number()), analyzedSeconds: z.number() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid, assetId, maxSeconds }, signal) => {
      const p = await getProject(pid);
      const a = assetId ? findAsset(p, assetId) : primaryVideoAsset(p);
      const r = await detectBeats(assetPath(pid, a), { maxSeconds, signal });
      return ok({ assetId: a.id, ...r });
    }
  );

  // ============================================================ التايملاين
  tool(
    "get_timeline",
    {
      title: "التايملاين",
      description: "المسارات والمقاطع بترتيب التصدير، والمدة الناتجة. (المقاطع مغناطيسية: start يُحسب من الترتيب.)",
      input: { projectId },
      output: timelineOut,
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid }) => ok(summarizeTimeline(await getProject(pid)))
  );

  tool(
    "list_tracks",
    {
      title: "المسارات",
      description: "مسارات المشروع مع عدد عناصر كل مسار.",
      input: { projectId },
      output: { tracks: timelineOut.tracks },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid }) => ok({ tracks: summarizeTimeline(await getProject(pid)).tracks })
  );

  tool(
    "list_clips",
    {
      title: "المقاطع",
      description: "مقاطع الفيديو (اختيارياً لمسار واحد) مع نقاط الدخول/الخروج بزمن المصدر وموضعها على التايملاين.",
      input: { projectId, trackId: entityId("تصفية بمسار").optional() },
      output: { clips: timelineOut.clips },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid, trackId }) => {
      const clips = summarizeTimeline(await getProject(pid)).clips;
      return ok({ clips: trackId ? clips.filter((c) => c.trackId === trackId) : clips });
    }
  );

  tool(
    "split_clip",
    {
      title: "تقسيم مقطع",
      description: "يقسم مقطعاً عند زمن على التايملاين إلى مقطعين (قابل للتراجع).",
      input: { projectId, clipId: entityId("معرّف المقطع"), atSeconds: seconds.describe("زمن التقسيم على التايملاين") },
      output: { ...editOut, newClipId: z.string() },
      annotations: { idempotentHint: false },
    },
    async ({ projectId: pid, clipId, atSeconds }) =>
      edit(pid, "split_clip", `تقسيم ${clipId} عند ${atSeconds}s`, (p) => {
        const r = splitClip(p, clipId, atSeconds);
        return { project: r.project, extra: { newClipId: r.newClipId } };
      })
  );

  tool(
    "trim_clip",
    {
      title: "قصّ مقطع",
      description: "يغيّر نقطة الدخول و/أو الخروج بزمن المصدر؛ المقاطع اللاحقة تُزاح تلقائياً (قابل للتراجع).",
      input: {
        projectId,
        clipId: entityId("معرّف المقطع"),
        inPoint: seconds.optional().describe("بداية جديدة بزمن المصدر"),
        outPoint: seconds.optional().describe("نهاية جديدة بزمن المصدر"),
      },
      output: editOut,
    },
    async ({ projectId: pid, clipId, inPoint, outPoint }) => {
      if (inPoint === undefined && outPoint === undefined) throw new EngineError("INVALID_INPUT", "حدّد inPoint أو outPoint");
      return edit(pid, "trim_clip", `قصّ ${clipId}`, (p) => ({ project: trimClip(p, clipId, { inPoint, outPoint }) }));
    }
  );

  tool(
    "move_clip",
    {
      title: "نقل مقطع",
      description: "يغيّر ترتيب مقطع داخل مساره (التايملاين مغناطيسي: الترتيب يحدد الموضع).",
      input: { projectId, clipId: entityId("معرّف المقطع"), toIndex: z.number().int().min(0).max(LIMITS.maxClips) },
      output: editOut,
    },
    async ({ projectId: pid, clipId, toIndex }) =>
      edit(pid, "move_clip", `نقل ${clipId} إلى ${toIndex}`, (p) => ({ project: moveClip(p, clipId, toIndex) }))
  );

  tool(
    "delete_clip",
    {
      title: "حذف مقطع",
      description: "يحذف مقطعاً ويُغلق الفجوة. عملية مدمّرة تتطلب موافقة المستخدم (قابلة للتراجع بعدها).",
      input: { projectId, clipId: entityId("معرّف المقطع") },
      output: editOut,
      annotations: { destructiveHint: true },
    },
    async ({ projectId: pid, clipId }) => {
      const p = await getProject(pid);
      if (!p.clips.some((c) => c.id === clipId)) throw new EngineError("NOT_FOUND", `المقطع غير موجود: ${clipId}`);
      await requireApproval(approver, { action: "حذف مقطع", summary: `حذف المقطع ${clipId} من «${p.name}» (يمكن التراجع لاحقاً).` });
      return edit(pid, "delete_clip", `حذف ${clipId}`, (q) => ({ project: deleteClip(q, clipId) }));
    }
  );

  tool(
    "set_clip_volume",
    {
      title: "مستوى صوت مقطع",
      description: "0 = صامت، 1 = الأصلي، حتى 2.",
      input: { projectId, clipId: entityId("معرّف المقطع"), volume: z.number().min(0).max(2) },
      output: editOut,
      annotations: { idempotentHint: true },
    },
    async ({ projectId: pid, clipId, volume }) =>
      edit(pid, "set_clip_volume", `صوت ${clipId} = ${volume}`, (p) => ({ project: setClipVolume(p, clipId, volume) }))
  );

  tool(
    "add_text_overlay",
    {
      title: "إضافة نص",
      description: "نص فوق الفيديو بزمن التايملاين (يُحرق في التصدير عبر ASS).",
      input: {
        projectId,
        text: z.string().min(1).max(LIMITS.maxText),
        start: seconds,
        end: seconds,
        position: z.enum(["top", "center", "bottom"]).default("center"),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFFFFF"),
        fontSize: z.number().min(12).max(200).default(48),
        animation: z.enum(["none", "fade", "pop"]).default("fade"),
      },
      output: { ...editOut, overlayId: z.string() },
    },
    async ({ projectId: pid, ...o }) =>
      edit(pid, "add_text_overlay", `نص «${o.text.slice(0, 30)}»`, (p) => {
        const r = addTextOverlay(p, o);
        return { project: r.project, extra: { overlayId: r.overlayId } };
      })
  );

  tool(
    "add_captions",
    {
      title: "إضافة ترجمات",
      description: "أسطر ترجمة بزمن التايملاين (بلا تداخل). replace=true يستبدل الموجود.",
      input: {
        projectId,
        cues: z.array(z.object({ start: seconds, end: seconds, text: z.string().min(1).max(LIMITS.maxText) })).min(1).max(2000),
        lang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/).default("ar"),
        replace: z.boolean().default(false),
      },
      output: { ...editOut, added: z.number() },
    },
    async ({ projectId: pid, cues, lang, replace }) =>
      edit(pid, "add_captions", `إضافة ${cues.length} سطر ترجمة`, (p) => {
        const r = addCaptions(p, cues, { lang, replace });
        return { project: r.project, extra: { added: r.added } };
      })
  );

  tool(
    "apply_effect",
    {
      title: "تطبيق تأثير",
      description:
        "kind=project_effect: تأثير يُطبَّق في التصدير على كل المقاطع (تفعيل/تعطيل). kind=color_filter: فلتر لون لمقطع واحد.",
      input: {
        projectId,
        kind: z.enum(["project_effect", "color_filter"]),
        effectId: z.enum(EFFECT_IDS).optional(),
        enabled: z.boolean().default(true),
        clipId: entityId("معرّف المقطع (لـ color_filter)").optional(),
        filter: z.enum(COLOR_FILTER_IDS).optional(),
      },
      output: editOut,
    },
    async ({ projectId: pid, kind, effectId, enabled, clipId, filter }) => {
      if (kind === "project_effect") {
        if (!effectId) throw new EngineError("INVALID_INPUT", "effectId مطلوب لـ project_effect", `المتاح: ${EFFECT_IDS.join(", ")}`);
        return edit(pid, "apply_effect", `${enabled ? "تفعيل" : "تعطيل"} ${effectId}`, (p) => ({ project: applyEffect(p, { kind, effectId, enabled }) }));
      }
      if (!clipId || !filter) throw new EngineError("INVALID_INPUT", "clipId وfilter مطلوبان لـ color_filter");
      return edit(pid, "apply_effect", `فلتر ${filter} على ${clipId}`, (p) => ({ project: applyEffect(p, { kind, clipId, filter }) }));
    }
  );

  tool(
    "add_audio_clip",
    {
      title: "إضافة صوت",
      description: "يضع أصل صوت مستورداً (موسيقى/تعليق) على مسار الصوت بزمن التايملاين — يُمزج فعلياً في التصدير.",
      input: {
        projectId,
        assetId: entityId("أصل صوت مستورد"),
        start: seconds.default(0),
        volume: z.number().min(0).max(2).default(0.5),
        kind: z.enum(["music", "voiceover", "sfx"]).default("music"),
      },
      output: { ...editOut, audioClipId: z.string() },
    },
    async ({ projectId: pid, assetId, start, volume, kind }) =>
      edit(pid, "add_audio_clip", `إضافة صوت ${assetId}`, (p) => {
        const a = findAsset(p, assetId);
        if (a.type !== "audio" && a.type !== "music" && a.type !== "sfx") throw new EngineError("UNSUPPORTED", "الأصل ليس ملف صوت");
        const r = addAudioClip(p, { name: a.name, url: a.url, start, duration: a.duration, volume, kind });
        return { project: r.project, extra: { audioClipId: r.audioClipId } };
      })
  );

  tool(
    "undo_edit",
    {
      title: "تراجع",
      description: "يتراجع عن آخر تعديل (يمكن إعادته عبر redo_edit).",
      input: { projectId },
      output: { projectId: z.string(), undone: z.object({ id: z.string(), op: z.string(), summary: z.string(), at: z.string() }), timeline: z.object(timelineOut) },
    },
    async ({ projectId: pid }) => {
      const r = await undo(pid);
      return ok({ projectId: pid, undone: r.undone, timeline: summarizeTimeline(r.project) }, `↶ ${r.undone.summary}`);
    }
  );

  tool(
    "redo_edit",
    {
      title: "إعادة",
      description: "يعيد آخر تعديل تم التراجع عنه.",
      input: { projectId },
      output: { projectId: z.string(), redone: z.object({ id: z.string(), op: z.string(), summary: z.string(), at: z.string() }), timeline: z.object(timelineOut) },
    },
    async ({ projectId: pid }) => {
      const r = await redo(pid);
      return ok({ projectId: pid, redone: r.redone, timeline: summarizeTimeline(r.project) }, `↷ ${r.redone.summary}`);
    }
  );

  tool(
    "list_edit_history",
    {
      title: "سجل التعديلات",
      description: "العمليات القابلة للتراجع/الإعادة (الأحدث أولاً، حتى 50).",
      input: { projectId },
      output: {
        undo: z.array(z.object({ id: z.string(), op: z.string(), summary: z.string(), at: z.string() })),
        redo: z.array(z.object({ id: z.string(), op: z.string(), summary: z.string(), at: z.string() })),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid }) => ok(await listHistory(pid))
  );

  // ============================================================ المهارات والمسارات
  tool(
    "list_skills",
    {
      title: "المهارات",
      description:
        "كتالوج مهارات lib/skills. المهارات تُنتج اقتراحات/حسابات ولا تعدّل المشروع؛ بعضها يعتمد بدائل محاكاة عند غياب تحليل حقيقي — راجع provenance في run_skill.",
      input: { category: z.enum(["analysis", "editing", "audio", "visual", "text", "generation", "export"]).optional() },
      output: { skills: z.array(z.object({ name: z.string(), description: z.string(), category: z.string(), inputSpec: z.record(z.string(), z.string()), outputSpec: z.record(z.string(), z.string()) })) },
      annotations: { readOnlyHint: true },
    },
    async ({ category }) => {
      const skills = buildSkillManager()
        .catalog()
        .filter((s) => !category || s.category === category)
        .map(({ name, description, category: c, inputSpec, outputSpec }) => ({ name, description, category: c, inputSpec, outputSpec }));
      return ok({ skills });
    }
  );

  async function buildDocument(pid: string | undefined, useRealAnalysis: boolean, extra: Record<string, unknown>, signal: AbortSignal) {
    const doc: Record<string, unknown> & { duration: number } = { duration: 30, ...extra };
    const notes: string[] = [];
    if (pid) {
      const p = await getProject(pid);
      doc.duration = timelineDuration(p) || p.duration || 30;
      doc.aspect = p.aspect;
      if (useRealAnalysis) {
        const a = primaryVideoAsset(p);
        const file = assetPath(pid, a);
        doc.silences = await detectSilence(file, { durationSeconds: a.duration, signal }).catch((e) => {
          notes.push(`تعذّر كشف الصمت: ${(e as Error).message}`);
          return undefined;
        });
        const sc = await analyzeScenes(file, a.duration, { signal }).catch((e) => {
          notes.push(`تعذّر كشف المشاهد: ${(e as Error).message}`);
          return null;
        });
        if (sc) doc.scenes = sc.scenes.map((s) => ({ ...s, score: 0.5 }));
        doc.duration = a.duration;
      }
    }
    return { doc, notes };
  }

  const docExtra = z
    .record(z.string().max(64), z.union([z.string().max(2000), z.number(), z.boolean()]))
    .refine((r) => Object.keys(r).length <= 20, "حتى 20 حقلاً")
    .optional()
    .describe("حقول إضافية لمستند المهارة (مثل topic لـ ScriptWriterSkill)");

  tool(
    "run_skill",
    {
      title: "تشغيل مهارة",
      description:
        "يشغّل مهارة واحدة على مستند مبني من المشروع (المدة الحقيقية؛ وصمت/مشاهد حقيقية إن useRealAnalysis). لا يعدّل المشروع. provenance=simulated يعني نتيجة غير مبنية على تحليل حقيقي.",
      input: {
        skill: z.string().regex(/^[A-Za-z]{3,60}Skill$/),
        projectId: projectId.optional(),
        useRealAnalysis: z.boolean().default(true),
        document: docExtra,
      },
      output: { skill: z.string(), ok: z.boolean(), provenance: z.enum(["simulated", "real-analysis", "computed"]), output: z.unknown(), error: z.string().optional(), logs: z.array(z.string()), notes: z.array(z.string()), durationMs: z.number() },
      annotations: { readOnlyHint: true },
    },
    async ({ skill, projectId: pid, useRealAnalysis, document }, signal) => {
      const m = buildSkillManager(); // مدير معزول لكل استدعاء — لا تلوّث لإعدادات مشتركة.
      if (!m.has(skill)) throw new EngineError("NOT_FOUND", `مهارة غير موجودة: ${skill}`, "استخدم list_skills.");
      const { doc, notes } = await buildDocument(pid, useRealAnalysis, document ?? {}, signal);
      const res = await m.runSkill(skill, doc, m.createContext(doc, { signal }));
      const provenance = skillProvenance(skill, res.logs);
      if (provenance === "simulated") notes.push("⚠️ نتيجة محاكاة/استدلالية — لا تعرضها كتحليل حقيقي");
      return ok({ skill, ok: res.ok, provenance, output: capJson(res.output), error: res.error, logs: res.logs.map((l) => l.message), notes, durationMs: res.durationMs });
    }
  );

  tool(
    "list_workflows",
    {
      title: "مسارات العمل",
      description: "مسارات المهارات المسجّلة وخطواتها.",
      input: {},
      output: { workflows: z.array(z.object({ name: z.string(), description: z.string(), steps: z.array(z.unknown()) })) },
      annotations: { readOnlyHint: true },
    },
    async () => ok({ workflows: buildSkillManager().listWorkflows().map((w) => ({ name: w.name, description: w.description, steps: w.list() })) })
  );

  tool(
    "run_workflow",
    {
      title: "تشغيل مسار عمل",
      description: "يشغّل مسار مهارات كاملاً ويعيد ناتج كل خطوة مع provenance. لا يعدّل المشروع — لتعديل التايملاين استخدم أدوات التايملاين أو الخطط.",
      input: {
        workflow: z.string().regex(/^[a-z0-9-]{1,40}$/),
        projectId: projectId.optional(),
        useRealAnalysis: z.boolean().default(true),
        document: docExtra,
      },
      output: {
        workflow: z.string(),
        ok: z.boolean(),
        steps: z.array(z.object({ skill: z.string(), ok: z.boolean(), provenance: z.string(), error: z.string().optional() })),
        results: z.unknown(),
        notes: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workflow, projectId: pid, useRealAnalysis, document }, signal) => {
      const m = buildSkillManager();
      if (!m.getWorkflow(workflow)) throw new EngineError("NOT_FOUND", `مسار غير موجود: ${workflow}`, "استخدم list_workflows.");
      const { doc, notes } = await buildDocument(pid, useRealAnalysis, document ?? {}, signal);
      const r = await m.runWorkflow(workflow, doc, { signal });
      const steps = r.steps.map((s) => ({ skill: s.skill, ok: s.ok, provenance: skillProvenance(s.skill, s.logs), error: s.error }));
      if (steps.some((s) => s.provenance === "simulated")) notes.push("⚠️ بعض الخطوات محاكاة — راجع provenance لكل خطوة");
      // المستند النهائي بلا الإطارات/الصوت الخام (قد تكون ضخمة).
      const { frames: _fr, audioBase64: _ab, ...docOut } = r.document;
      return ok({ workflow, ok: r.ok, steps, results: capJson(docOut), notes: [...notes, ...r.errors] });
    }
  );

  // ============================================================ الخطط (مسار وكلاء Python)
  tool(
    "create_editing_plan",
    {
      title: "إنشاء خطة مونتاج",
      description:
        "يشغّل مسار الوكلاء (Analyst → Director → Critic → Audio) على فيديو المشروع ويحفظ خطة EDL. لا يغيّر المشروع. " +
        "افتراضياً بلا مزوّدات مدفوعة (المفاتيح تُزال من البيئة)؛ allowPaidProviders=true يتطلب موافقة المستخدم.",
      input: {
        projectId,
        request: z.string().min(3).max(800).describe("طلب المونتاج بلغة طبيعية"),
        language: z.string().regex(/^[a-z]{2,3}$/).default("ar"),
        aspect: z.enum(["9:16", "16:9", "1:1"]).default("16:9"),
        mood: z.string().max(20).optional(),
        allowPaidProviders: z.boolean().default(false),
      },
      output: {
        planId: z.string(),
        mode: z.string(),
        pipelineStatus: z.string(),
        title: z.string().optional(),
        segments: z.number(),
        keepSegments: z.number(),
        captions: z.number(),
        critic: z.object({ score: z.number(), verdict: z.string(), suggestions: z.array(z.string()) }).nullable(),
        warnings: z.array(z.string()),
        nextStep: z.string(),
      },
    },
    async ({ projectId: pid, request, language, aspect, mood, allowPaidProviders }, signal) => {
      if (allowPaidProviders) {
        await requireApproval(approver, { action: "خطة بمزوّد مدفوع", summary: "سيُرسل الصوت/الإطارات/النص إلى مزوّد LLM خارجي بمفاتيحك وقد يكلّف مالاً." });
      }
      const plan = await createPlan(pid, { request, language, aspect, mood, allowPaidProviders, signal });
      return ok(
        {
          planId: plan.id,
          mode: plan.mode,
          pipelineStatus: plan.pipelineStatus,
          title: plan.edl.title,
          segments: plan.edl.segments.length,
          keepSegments: plan.edl.segments.filter((s) => s.keep).length,
          captions: plan.edl.captions?.length ?? 0,
          critic: plan.critic,
          warnings: plan.warnings.slice(0, 30),
          nextStep: "راجع الخطة عبر review_editing_plan ثم اعرضها على المستخدم قبل apply_editing_plan.",
        },
        "✓ خطة محفوظة (لم يتغيّر المشروع)"
      );
    }
  );

  tool(
    "review_editing_plan",
    {
      title: "مراجعة خطة",
      description: "يتحقق من الخطة مقابل المصدر الحالي ويلخّص التغييرات المتوقعة قبل التطبيق.",
      input: { projectId, planId: entityId("معرّف الخطة") },
      output: {
        ok: z.boolean(),
        errors: z.array(z.string()),
        warnings: z.array(z.string()),
        expectedChanges: z.looseObject({ plannedDurationSeconds: z.number() }),
        critic: z.object({ score: z.number(), verdict: z.string(), suggestions: z.array(z.string()) }).nullable(),
        segments: z.array(z.object({ start: z.number(), end: z.number(), keep: z.boolean(), reason: z.string().optional() })),
        appliedAt: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid, planId }) => {
      const r = await reviewPlan(pid, planId);
      const plan = await getPlan(pid, planId);
      return ok({
        ...r,
        expectedChanges: r.expectedChanges as unknown as { plannedDurationSeconds: number },
        segments: plan.edl.segments.map((s) => ({ start: s.start, end: s.end, keep: s.keep, reason: s.reason })),
      });
    }
  );

  tool(
    "apply_editing_plan",
    {
      title: "تطبيق خطة",
      description: "يطبّق خطة مراجَعة على التايملاين (مقاطع + ترجمات + نصوص) كعملية واحدة قابلة للتراجع — يتطلب موافقة المستخدم.",
      input: { projectId, planId: entityId("معرّف الخطة") },
      output: { ...editOut, applied: z.looseObject({ plannedClips: z.number() }), droppedCaptions: z.number() },
      annotations: { destructiveHint: true },
    },
    async ({ projectId: pid, planId }) => {
      const review = await reviewPlan(pid, planId);
      if (!review.ok) throw new EngineError("CONFLICT", `الخطة لا تجتاز المراجعة: ${review.errors.join("؛ ")}`);
      const c = review.expectedChanges;
      await requireApproval(approver, {
        action: "تطبيق خطة مونتاج",
        summary: `سيُستبدل مسار الفيديو بـ ${c.plannedClips} مقطعاً (المدة ${c.currentDurationSeconds}s → ${c.plannedDurationSeconds}s، حذف ${c.removedSeconds}s)، وإضافة ${c.captionsToAdd} ترجمة و${c.textOverlaysToAdd} نص. قابل للتراجع.`,
      });
      const r = await applyPlan(pid, planId);
      return ok(
        { projectId: pid, historyId: r.historyId, timeline: summarizeTimeline(r.project), applied: r.summary as unknown as { plannedClips: number }, droppedCaptions: r.droppedCaptions },
        "✓ طُبّقت الخطة على التايملاين (لم يُرندر شيء بعد)"
      );
    }
  );

  // ============================================================ المعاينة والتصدير
  tool(
    "generate_preview",
    {
      title: "معاينة",
      description: "رندر منخفض الدقة (360p، حتى 60s) لنافذة من التايملاين. wait=true ينتظر الانتهاء (حتى 120s).",
      input: {
        projectId,
        start: seconds.default(0),
        end: seconds.optional().describe("افتراضي start+10"),
        wait: z.boolean().default(true),
      },
      output: jobOut,
    },
    async ({ projectId: pid, start, end, wait }) => {
      const job = await startRender(pid, { kind: "preview", range: { start, end: end ?? start + 10 } });
      const final = wait ? await waitForJob(pid, job.id, 120_000) : job;
      return ok(publicJob(final, final.outputFile ? `${pidRel(pid)}/renders/${final.id}/${final.outputFile}` : null), `معاينة: ${final.status}`);
    }
  );

  tool(
    "export_project",
    {
      title: "تصدير",
      description:
        "تصدير كامل بالإعدادات (الدقة/الصيغة/الجودة) — مكلف زمنياً ويتطلب موافقة المستخدم. يعمل في الخلفية: تابع عبر get_render_status. " +
        "النجاح = status=completed فقط (بعد مراجعة ffprobe).",
      input: { projectId, wait: z.boolean().default(false).describe("انتظار حتى 10 دقائق") },
      output: jobOut,
    },
    async ({ projectId: pid, wait }) => {
      const p = await getProject(pid);
      await requireApproval(approver, {
        action: "تصدير الفيديو",
        summary: `تصدير «${p.name}» بمدة ${timelineDuration(p)}s بدقة ${p.resolution} ${p.aspect} (${p.format}) — قد يستغرق وقتاً ويستهلك المعالج.`,
      });
      const job = await startRender(pid, { kind: "export" });
      const final = wait ? await waitForJob(pid, job.id, 600_000) : job;
      return ok(publicJob(final, final.outputFile ? `${pidRel(pid)}/renders/${final.id}/${final.outputFile}` : null), `تصدير: ${final.status}`);
    }
  );

  tool(
    "get_render_status",
    {
      title: "حالة الرندر",
      description: "حالة مهمة معاينة/تصدير (أو آخر المهام إن لم يُحدَّد jobId).",
      input: { projectId, jobId: entityId("معرّف المهمة").optional() },
      output: { jobs: z.array(z.object(jobOut)) },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId: pid, jobId }) => {
      const jobs = jobId ? [await getJob(pid, jobId)] : (await listJobs(pid)).slice(0, 10);
      return ok({ jobs: jobs.map((j) => publicJob(j, j.outputFile ? `${pidRel(pid)}/renders/${j.id}/${j.outputFile}` : null)) });
    }
  );

  tool(
    "cancel_render",
    {
      title: "إلغاء رندر",
      description: "يوقف مهمة جارية ويحذف المخرَج الجزئي.",
      input: { projectId, jobId: entityId("معرّف المهمة") },
      output: jobOut,
    },
    async ({ projectId: pid, jobId }) => {
      const j = await cancelJob(pid, jobId);
      return ok(publicJob(j, null), `الحالة: ${j.status}`);
    }
  );

  tool(
    "validate_render",
    {
      title: "التحقق من المخرَج",
      description: "يعيد فحص ملف المخرَج: ffprobe (مدة/مسارات/أبعاد) + blackdetect + volumedetect.",
      input: { projectId, jobId: entityId("معرّف المهمة") },
      output: jobOut,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ projectId: pid, jobId }) => {
      const j = await revalidateJob(pid, jobId);
      return ok(publicJob(j, j.outputFile ? `${pidRel(pid)}/renders/${j.id}/${j.outputFile}` : null), j.review?.passed ? "✓ المخرَج سليم" : "✗ المخرَج فشل الفحص");
    }
  );

  return server;
}

/** مسار نسبي إلى مساحة العمل (لا يكشف مسارات مطلقة خارجها). */
function pidRel(pid: string): string {
  return `projects/${pid}`;
}

export { errorShape };
