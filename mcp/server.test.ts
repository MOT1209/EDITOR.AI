// اختبارات تكامل MCP: عميل MCP حقيقي (SDK الرسمي) ↔ الخادم عبر نقل داخلي.
// تشغيل FFmpeg حقيقي على test_assets/test_video.mp4 — لا استجابات مقلَّدة.
// تُتخطّى مجموعات FFmpeg/Python تلقائياً (skipped، لا passed) عند غيابها.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, readdirSync } from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMontageServer } from "./server";
import type { Approver } from "./approval";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const PY = process.platform === "win32" ? "python" : "python3";
const HAS_PIPELINE = spawnSync(PY, ["-c", "import pydantic, src.agents"], { cwd: process.cwd() }).status === 0;
const SAMPLE = path.resolve("test_assets/test_video.mp4");

let tmp: string;
let inbox: string;
let outside: string;
const approvals: string[] = [];
let approveNext = true;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function connect(opts: { approver?: Approver; elicitation?: boolean } = {}) {
  const server = createMontageServer({ approver: opts.approver });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "montage-test", version: "1.0.0" }, { capabilities: opts.elicitation ? { elicitation: {} } : {} });
  if (opts.elicitation) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      approvals.push(String(req.params.message));
      return approveNext ? { action: "accept", content: { approve: true } } : { action: "decline" };
    });
  }
  await Promise.all([server.connect(st), client.connect(ct)]);
  const call = async (name: string, args: Json = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, data: (r.structuredContent ?? {}) as Json, text: (r.content as { text: string }[])[0]?.text ?? "" };
  };
  return { client, server, call };
}

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "montage_mcp_test_"));
  inbox = path.join(tmp, "workspace", "inbox");
  outside = path.join(tmp, "outside");
  mkdirSync(inbox, { recursive: true });
  mkdirSync(outside, { recursive: true });
  process.env.MONTAGE_WORKSPACE = path.join(tmp, "workspace");
  process.env.MONTAGE_MEDIA_ROOTS = path.resolve("test_assets");
  delete process.env.MONTAGE_MCP_APPROVAL;
  if (HAS_FFMPEG) copyFileSync(SAMPLE, path.join(inbox, "clip.mp4"));
  writeFileSync(path.join(outside, "secret.mp4"), "not a video");
  writeFileSync(path.join(inbox, "fake.mp4"), "this is not a real video");
  writeFileSync(path.join(inbox, "notes.txt"), "hello");
  symlinkSync(path.join(outside, "secret.mp4"), path.join(inbox, "link.mp4"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("MCP discovery and validation", () => {
  it("lists every tool with input and output schemas and annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const required of [
      "list_projects", "get_project", "create_project", "get_project_status",
      "import_media", "list_media_assets", "inspect_media", "analyze_scenes", "detect_silence", "detect_beats",
      "get_timeline", "list_tracks", "list_clips", "split_clip", "trim_clip", "move_clip", "delete_clip",
      "set_clip_volume", "add_text_overlay", "add_captions", "apply_effect", "undo_edit", "redo_edit", "list_edit_history",
      "list_skills", "run_skill", "list_workflows", "run_workflow", "create_editing_plan", "review_editing_plan", "apply_editing_plan",
      "generate_preview", "get_render_status", "validate_render", "export_project", "cancel_render",
    ]) expect(names).toContain(required);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema?.type).toBe("object");
      expect(t.description && t.description.length).toBeGreaterThan(10);
    }
    expect(tools.find((t) => t.name === "export_project")?.annotations?.readOnlyHint).not.toBe(true);
    expect(tools.find((t) => t.name === "delete_clip")?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "get_timeline")?.annotations?.readOnlyHint).toBe(true);
  });

  it("rejects schema-invalid input with a tool error (not a crash)", async () => {
    const { call } = await connect();
    const r = await call("create_project", { name: "", aspect: "21:9" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/validation|Invalid/i);
  });

  it("rejects path-like project ids before touching the filesystem", async () => {
    const { call } = await connect();
    for (const bad of ["../etc", "..", "a/b", "x".repeat(200)]) {
      const r = await call("get_project", { projectId: bad });
      expect(r.isError).toBe(true);
    }
  });

  it("returns NOT_FOUND with a hint for unknown projects", async () => {
    const { call } = await connect();
    const r = await call("get_project", { projectId: "p_doesnotexist" });
    expect(r.isError).toBe(true);
    expect(r.data.error).toMatchObject({ code: "NOT_FOUND" });
    expect(r.data.error.hint).toBeTruthy();
  });

  it("lists skills and labels simulated output honestly", async () => {
    const { call } = await connect();
    const s = await call("list_skills");
    expect(s.data.skills.length).toBeGreaterThanOrEqual(43);
    const r = await call("run_skill", { skill: "SpeechRecognitionSkill", useRealAnalysis: false });
    expect(r.data.provenance).toBe("simulated");
    const t = await call("run_skill", { skill: "TitleGenerationSkill", useRealAnalysis: false, document: { topic: "x" } });
    expect(t.isError).toBe(false);
    expect(t.data.skill).toBe("TitleGenerationSkill");
    expect((await call("run_skill", { skill: "NoSuchSkill" })).data.error.code).toBe("NOT_FOUND");
  });
});

describe.skipIf(!HAS_FFMPEG)("MCP filesystem boundaries", () => {
  let pid: string;
  beforeAll(async () => {
    const { call } = await connect();
    pid = (await call("create_project", { name: "boundaries" })).data.projectId;
  });

  it("refuses files outside the allowed roots", async () => {
    const { call } = await connect();
    const r = await call("import_media", { projectId: pid, path: path.join(outside, "secret.mp4") });
    expect(r.data.error.code).toBe("FORBIDDEN_PATH");
    const etc = await call("import_media", { projectId: pid, path: "/etc/passwd" });
    expect(etc.data.error.code).toBe("FORBIDDEN_PATH");
  });

  it("refuses traversal and symlink escapes from an allowed root", async () => {
    const { call } = await connect();
    expect((await call("import_media", { projectId: pid, path: "../../outside/secret.mp4" })).data.error.code).toBe("FORBIDDEN_PATH");
    expect((await call("import_media", { projectId: pid, path: "../../outside/does-not-exist.mp4" })).data.error.code).toBe("FORBIDDEN_PATH");
    expect((await call("import_media", { projectId: pid, path: path.join(inbox, "link.mp4") })).data.error.code).toBe("FORBIDDEN_PATH");
  });

  it("refuses missing files, bad extensions, and fake media", async () => {
    const { call } = await connect();
    expect((await call("import_media", { projectId: pid, path: "missing.mp4" })).data.error.code).toBe("NOT_FOUND");
    expect((await call("import_media", { projectId: pid, path: "notes.txt" })).data.error.code).toBe("UNSUPPORTED");
    expect((await call("import_media", { projectId: pid, path: "fake.mp4" })).data.error.code).toBe("EXECUTION_FAILED");
    const assets = await call("list_media_assets", { projectId: pid });
    expect(assets.data.assets).toEqual([]);
  });

  it("does not expose absolute workspace paths for render outputs", async () => {
    const { call } = await connect();
    const r = await call("get_render_status", { projectId: pid });
    expect(JSON.stringify(r.data)).not.toContain(tmp);
  });
});

describe.skipIf(!HAS_FFMPEG)("MCP end-to-end on the sample video (real FFmpeg)", () => {
  let pid: string;
  let clipId: string;

  it("creates a project and imports + inspects the sample", async () => {
    const { call } = await connect();
    pid = (await call("create_project", { name: "e2e", aspect: "16:9", resolution: "720p" })).data.projectId;
    const imp = await call("import_media", { projectId: pid, path: SAMPLE });
    expect(imp.isError).toBe(false);
    expect(imp.data.clipCreated).toBe(true);
    const assetId = imp.data.asset.id;
    const info = await call("inspect_media", { projectId: pid, assetId });
    expect(info.data).toMatchObject({ durationSeconds: 30, video: { codec: "h264", width: 640, height: 360 }, audio: { codec: "aac" } });
    const tl = await call("get_timeline", { projectId: pid });
    expect(tl.data.durationSeconds).toBe(30);
    clipId = tl.data.clips[0].id;
  });

  it("runs real analysis tools", async () => {
    const { call } = await connect();
    const sil = await call("detect_silence", { projectId: pid, noiseDb: -30 });
    expect(sil.isError).toBe(false);
    expect(Array.isArray(sil.data.silences)).toBe(true);
    const sc = await call("analyze_scenes", { projectId: pid });
    expect(sc.isError).toBe(false);
    expect(sc.data.scenes.at(-1).end).toBeCloseTo(30, 1);
    const bt = await call("detect_beats", { projectId: pid, maxSeconds: 30 });
    expect(bt.data.method).toBe("energy-onset");
  });

  it("edits the timeline and supports undo/redo with history", async () => {
    const { call } = await connect();
    const split = await call("split_clip", { projectId: pid, clipId, atSeconds: 10 });
    expect(split.isError).toBe(false);
    const second = split.data.newClipId;
    const trim = await call("trim_clip", { projectId: pid, clipId: second, outPoint: 22 });
    expect(trim.data.timeline.durationSeconds).toBe(22);
    const bad = await call("trim_clip", { projectId: pid, clipId: second, outPoint: 99 });
    expect(bad.data.error.code).toBe("OUT_OF_RANGE");
    await call("set_clip_volume", { projectId: pid, clipId: second, volume: 0.8 });
    await call("add_captions", { projectId: pid, cues: [{ start: 0.5, end: 2.5, text: "مرحباً" }, { start: 11, end: 13, text: "تجربة" }] });
    await call("add_text_overlay", { projectId: pid, text: "MontageAI", start: 1, end: 4, position: "top" });
    await call("apply_effect", { projectId: pid, kind: "color_filter", clipId, filter: "warm" });

    const hist = await call("list_edit_history", { projectId: pid });
    expect(hist.data.undo.map((h: Json) => h.op)).toEqual(["apply_effect", "add_text_overlay", "add_captions", "set_clip_volume", "trim_clip", "split_clip", "import_media"]);

    const u = await call("undo_edit", { projectId: pid });
    expect(u.data.undone.op).toBe("apply_effect");
    expect((await call("get_project", { projectId: pid })).data.project.clips.find((c: Json) => c.id === clipId).colorFilter).toBe("none");
    const r = await call("redo_edit", { projectId: pid });
    expect(r.data.redone.op).toBe("apply_effect");
    expect((await call("get_project", { projectId: pid })).data.project.clips.find((c: Json) => c.id === clipId).colorFilter).toBe("warm");
  });

  it("refuses destructive/expensive ops without an elicitation-capable client", async () => {
    const { call } = await connect(); // لا elicitation ولا موافق مُحقن
    const del = await call("delete_clip", { projectId: pid, clipId });
    expect(del.data.error.code).toBe("APPROVAL_DENIED");
    const exp = await call("export_project", { projectId: pid });
    expect(exp.data.error.code).toBe("APPROVAL_DENIED");
    const tl = await call("get_timeline", { projectId: pid });
    expect(tl.data.clips).toHaveLength(2); // لم يتغير شيء
  });

  it("generates a real low-res preview validated by ffprobe", async () => {
    const { call } = await connect();
    const p = await call("generate_preview", { projectId: pid, start: 8, end: 14, wait: true });
    expect(p.data.status).toBe("completed");
    expect(p.data.review.passed).toBe(true);
    expect(p.data.review.details).toMatchObject({ hasVideo: true, hasAudio: true, width: 640, height: 360 });
    expect(p.data.review.details.durationSeconds).toBeCloseTo(6, 0);
    expect(p.data.outputPath).toMatch(/^projects\/p_/);
  });

  it("exports through the elicitation approval flow and verifies the file", async () => {
    approveNext = true;
    const { call } = await connect({ elicitation: true });
    const r = await call("export_project", { projectId: pid, wait: true });
    expect(approvals.at(-1)).toMatch(/تصدير/);
    expect(r.data.status).toBe("completed");
    expect(r.data.review.passed).toBe(true);
    const out = path.join(process.env.MONTAGE_WORKSPACE!, r.data.outputPath);
    const probe = JSON.parse(
      spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", out], { encoding: "utf-8" }).stdout
    );
    const v = probe.streams.find((s: Json) => s.codec_type === "video");
    const a = probe.streams.find((s: Json) => s.codec_type === "audio");
    expect(v).toMatchObject({ codec_name: "h264", width: 1280, height: 720, pix_fmt: "yuv420p" });
    expect(a.codec_name).toBe("aac");
    expect(Number(probe.format.duration)).toBeGreaterThan(21.5);
    expect(Number(probe.format.duration)).toBeLessThan(22.5);
    const again = await call("validate_render", { projectId: pid, jobId: r.data.id });
    expect(again.data.review.passed).toBe(true);
  });

  it("a declined approval changes nothing", async () => {
    approveNext = false;
    const { call } = await connect({ elicitation: true });
    const del = await call("delete_clip", { projectId: pid, clipId });
    expect(del.data.error.code).toBe("APPROVAL_DENIED");
    expect((await call("get_timeline", { projectId: pid })).data.clips).toHaveLength(2);
    approveNext = true;
  });

  it("cancels a running export and leaves no partial output", async () => {
    const { call } = await connect({ approver: async () => true });
    const start = await call("export_project", { projectId: pid, wait: false });
    expect(start.data.status).toBe("running");
    const c = await call("cancel_render", { projectId: pid, jobId: start.data.id });
    expect(c.data.status).toBe("cancelled");
    const dir = path.join(process.env.MONTAGE_WORKSPACE!, "projects", pid, "renders", start.data.id);
    expect(readdirSync(dir)).toEqual(["status.json"]);
  });

  it("reports a failure (not success) when the source media disappears", async () => {
    const { call } = await connect({ approver: async () => true });
    const p2 = (await call("create_project", { name: "broken" })).data.projectId;
    const imp = await call("import_media", { projectId: p2, path: SAMPLE });
    const mediaDir = path.join(process.env.MONTAGE_WORKSPACE!, "projects", p2, "media");
    for (const f of readdirSync(mediaDir)) unlinkSync(path.join(mediaDir, f));
    expect(imp.isError).toBe(false);
    const r = await call("export_project", { projectId: p2, wait: true });
    expect(r.data.status).toBe("failed");
    expect(r.data.error).toBeTruthy();
    expect(r.data.outputPath).toBeUndefined();
  });

  it("runs a workflow on real silence/scene analysis with provenance", async () => {
    const { call } = await connect();
    const r = await call("run_workflow", { workflow: "default", projectId: pid, useRealAnalysis: true });
    expect(r.isError).toBe(false);
    const steps = Object.fromEntries(r.data.steps.map((s: Json) => [s.skill, s.provenance]));
    expect(steps.SilenceDetectionSkill).toBe("real-analysis");
    expect(steps.SceneDetectionSkill).toBe("real-analysis");
    expect(steps.SpeechRecognitionSkill).toBe("simulated");
  });
});

describe.skipIf(!HAS_FFMPEG || !HAS_PIPELINE)("MCP ↔ Python agents (plan → review → approve → apply)", () => {
  it("creates a local plan, reviews it, applies it after approval, and can undo", async () => {
    const { call } = await connect({ approver: async () => true });
    const pid = (await call("create_project", { name: "plan" })).data.projectId;
    await call("import_media", { projectId: pid, path: SAMPLE });
    const before = await call("get_timeline", { projectId: pid });

    const plan = await call("create_editing_plan", { projectId: pid, request: "فيديو قصير بلا صمت", aspect: "16:9" });
    expect(plan.isError).toBe(false);
    expect(plan.data.mode).toBe("local");
    expect(plan.data.keepSegments).toBeGreaterThan(0);
    // الخطة لا تغيّر المشروع.
    expect((await call("get_timeline", { projectId: pid })).data).toEqual(before.data);

    const review = await call("review_editing_plan", { projectId: pid, planId: plan.data.planId });
    expect(review.data.ok).toBe(true);

    const applied = await call("apply_editing_plan", { projectId: pid, planId: plan.data.planId });
    expect(applied.isError).toBe(false);
    expect(applied.data.timeline.clips.length).toBe(review.data.expectedChanges.plannedClips);
    expect(applied.data.timeline.durationSeconds).toBeCloseTo(review.data.expectedChanges.plannedDurationSeconds, 1);

    const twice = await call("apply_editing_plan", { projectId: pid, planId: plan.data.planId });
    expect(twice.data.error.code).toBe("CONFLICT");

    await call("undo_edit", { projectId: pid });
    expect((await call("get_timeline", { projectId: pid })).data.durationSeconds).toBe(30);
  });
});
