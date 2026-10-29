// اختبار E2E حقيقي لخادم MCP عبر stdio (عملية منفصلة، كما يشغّله Claude Desktop/Code).
//   التشغيل: pnpm mcp:e2e
// لا تقليد: FFmpeg حقيقي + test_assets/test_video.mp4 + تحقق ffprobe مستقل للمخرَج.
// يستخدم مساحة عمل مؤقتة ويحذفها في النهاية. رمز الخروج ≠ 0 عند أي فشل.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { parseToolError } from "../mcp/server";
import os from "os";
import path from "path";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const root = process.cwd();
const ws = mkdtempSync(path.join(os.tmpdir(), "montage_mcp_e2e_"));
const sample = path.join(root, "test_assets", "test_video.mp4");
let failures = 0;

function check(cond: unknown, label: string, detail?: unknown) {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "--tsconfig", "tsconfig.json", "mcp/stdio.ts"],
    cwd: root,
    env: {
      ...(process.env as Record<string, string>),
      MONTAGE_WORKSPACE: ws,
      MONTAGE_MEDIA_ROOTS: path.join(root, "test_assets"),
      // التفويض المسبق هنا قرار المشغّل البشري لهذا الاختبار (العميل بلا elicitation).
      MONTAGE_MCP_APPROVAL: "auto",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "montage-e2e", version: "1.0.0" });
  await client.connect(transport);
  const call = async (name: string, args: Json = {}) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 });
    if (r.isError) {
      const text = (r.content as { text: string }[])[0]?.text ?? "";
      return { isError: true, data: { error: parseToolError(text) } as Json };
    }
    return { isError: false, data: (r.structuredContent ?? {}) as Json };
  };

  const { tools } = await client.listTools();
  check(tools.length >= 36, "اكتشاف الأدوات عبر stdio", `${tools.length} أداة`);

  const pid = (await call("create_project", { name: "E2E stdio", aspect: "16:9", resolution: "720p" })).data.projectId;
  check(/^p_/.test(pid), "create_project", pid);

  const imp = await call("import_media", { projectId: pid, path: sample });
  check(!imp.isError && imp.data.clipCreated, "import_media (الفيديو العيّنة)", imp.data.asset);
  const info = await call("inspect_media", { projectId: pid, assetId: imp.data.asset.id });
  check(info.data.durationSeconds === 30 && info.data.video?.codec === "h264", "inspect_media (ffprobe)", info.data.video);

  const sil = await call("detect_silence", { projectId: pid });
  check(!sil.isError, "detect_silence", `${sil.data.silences?.length} فترة`);
  const sc = await call("analyze_scenes", { projectId: pid });
  check(!sc.isError, "analyze_scenes", `${sc.data.cuts?.length} قطع`);

  const tl = await call("get_timeline", { projectId: pid });
  const clipId = tl.data.clips[0].id;
  const split = await call("split_clip", { projectId: pid, clipId, atSeconds: 12 });
  check(!split.isError, "split_clip عند 12s");
  const trim = await call("trim_clip", { projectId: pid, clipId: split.data.newClipId, inPoint: 20 });
  check(trim.data.timeline?.durationSeconds === 22, "trim_clip → مدة التايملاين 22s", trim.data.timeline?.durationSeconds);
  await call("add_captions", { projectId: pid, cues: [{ start: 1, end: 3, text: "اختبار stdio" }] });
  await call("add_text_overlay", { projectId: pid, text: "E2E", start: 0, end: 2, position: "top" });

  const undo = await call("undo_edit", { projectId: pid });
  check(undo.data.undone?.op === "add_text_overlay", "undo_edit", undo.data.undone?.op);
  const redo = await call("redo_edit", { projectId: pid });
  check(redo.data.redone?.op === "add_text_overlay", "redo_edit", redo.data.redone?.op);

  const prev = await call("generate_preview", { projectId: pid, start: 10, end: 16, wait: true });
  check(prev.data.status === "completed" && prev.data.review?.passed, "generate_preview (360p، مراجعة ناجحة)", prev.data.review?.details);

  const exp = await call("export_project", { projectId: pid, wait: true });
  check(exp.data.status === "completed", "export_project", exp.data.status + (exp.data.error ? `: ${exp.data.error}` : ""));
  const out = path.join(ws, exp.data.outputPath ?? "missing");
  const probe = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", out], { encoding: "utf-8" });
  const pj = probe.status === 0 ? JSON.parse(probe.stdout) : null;
  const v = pj?.streams?.find((s: Json) => s.codec_type === "video");
  const a = pj?.streams?.find((s: Json) => s.codec_type === "audio");
  const dur = Number(pj?.format?.duration);
  check(v?.codec_name === "h264" && v?.width === 1280 && v?.height === 720, "ffprobe مستقل: فيديو h264 1280×720", v && `${v.codec_name} ${v.width}x${v.height}`);
  check(a?.codec_name === "aac", "ffprobe مستقل: صوت aac", a?.codec_name);
  check(Math.abs(dur - 22) < 0.5, "ffprobe مستقل: المدة ≈ 22s (30 − 8 مقطوعة)", dur);

  const val = await call("validate_render", { projectId: pid, jobId: exp.data.id });
  check(val.data.review?.passed === true, "validate_render", val.data.review?.details);

  // رفض الطلبات غير الصالحة/غير المصرّح بها
  const outside = await call("import_media", { projectId: pid, path: "/etc/passwd" });
  check(outside.data.error?.code === "FORBIDDEN_PATH", "رفض ملف خارج الجذور", outside.data.error?.code);
  const trav = await call("get_project", { projectId: "../../etc" });
  check(trav.isError, "رفض معرّف مشروع بمسار", "isError");
  const bad = await call("trim_clip", { projectId: pid, clipId, outPoint: 999 });
  check(bad.data.error?.code === "OUT_OF_RANGE", "رفض قص خارج المصدر", bad.data.error?.code);
  const unknown = await call("split_clip", { projectId: pid, clipId: "nope", atSeconds: 1 });
  check(unknown.data.error?.code === "NOT_FOUND", "رفض مقطع غير موجود", unknown.data.error?.code);

  await client.close();
}

main()
  .catch((e) => {
    console.error("✗ فشل غير متوقع:", e);
    failures++;
  })
  .finally(() => {
    rmSync(ws, { recursive: true, force: true });
    console.log(failures === 0 ? "\nE2E: كل الفحوص نجحت" : `\nE2E: ${failures} فحص فشل`);
    process.exit(failures === 0 ? 0 : 1);
  });
