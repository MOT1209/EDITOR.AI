// تكامل MCP للأدوات المخصّصة: عميل MCP حقيقي ↔ خادم عبر نقل داخلي، سجل دائم على قرص مؤقت.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMontageServerWithControls } from "./server";
import { parseToolError } from "./results";
import * as svc from "@/lib/extensions/service";
import { createProject, getProject } from "@/lib/engine/store";

let tmp: string;
beforeAll(() => { tmp = mkdtempSync(path.join(os.tmpdir(), "montage_mcp_ext_")); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  process.env.MONTAGE_WORKSPACE = path.join(tmp, `ws_${Math.random().toString(36).slice(2)}`);
  delete process.env.MONTAGE_MCP_APPROVAL;
  delete process.env.MONTAGE_EXT_EXTERNAL;
});

const projectsTool = {
  manifest: {
    kind: "tool", id: "my_projects", version: "1.0.0", name: "مشاريعي", description: "يعرض المشاريع", category: "utility",
    permissions: ["project.read"], dependencies: { actions: ["project.list"] }, execution: { type: "declarative", action: "project.list", args: {} },
  },
  files: {},
};
const addTitleTool = {
  manifest: {
    kind: "tool", id: "add_title", version: "1.0.0", name: "عنوان", description: "يضيف عنواناً", category: "editing",
    permissions: ["project.write"], dependencies: { actions: ["timeline.add_text"] },
    input: { type: "object", properties: { projectId: { type: "string", maxLength: 80 }, text: { type: "string", maxLength: 100 } }, required: ["projectId", "text"] },
    execution: { type: "declarative", action: "timeline.add_text", args: { projectId: "{{input.projectId}}", text: "{{input.text}}", start: 0, end: 1 } },
  },
  files: {},
};

async function setup(elicit?: boolean) {
  const { server, custom } = createMontageServerWithControls({ customToolsPollMs: 0 });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" }, { capabilities: elicit ? { elicitation: {} } : {} });
  const approvals: string[] = [];
  if (elicit) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => { approvals.push(String(req.params.message)); return { action: "accept", content: { approve: true } }; });
  }
  let changed = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => { changed++; });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const names = async () => (await client.listTools()).tools.map((t) => t.name);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0]?.text ?? "";
    return { isError: !!r.isError, data: (r.structuredContent ?? {}) as Record<string, any>, err: r.isError ? parseToolError(text) : null };
  };
  return { client, custom, names, call, approvals, changed: () => changed };
}

async function publish(raw: object, grants: string[]) {
  const kind = (raw as { manifest: { kind: "tool" } }).manifest.kind;
  const id = (raw as { manifest: { id: string } }).manifest.id;
  await svc.saveExtension(raw, { kind, origin: "user", update: false });
  await svc.grantPermissions(kind, id, grants);
  await svc.runExtension(kind, id, id === "add_title" ? { projectId: "x", text: "t" } : {}, { mode: "test", approve: async () => {} }).catch(() => {});
}

describe("custom tools over MCP", () => {
  it("exposes only enabled, valid, granted tools under ext_ names and keeps built-ins", async () => {
    const s = await setup();
    const base = await s.names();
    expect(base).toContain("list_projects");
    expect(base).toContain("list_custom_tools");
    expect(base.some((n) => n.startsWith("ext_"))).toBe(false);

    await svc.saveExtension(projectsTool, { kind: "tool", origin: "user", update: false });
    await s.custom.sync();
    expect(await s.names()).not.toContain("ext_my_projects"); // معطّلة

    await svc.grantPermissions("tool", "my_projects", ["project.read"]);
    await svc.runExtension("tool", "my_projects", {}, { mode: "test" });
    await svc.setEnabled("tool", "my_projects", true);
    const exp = await s.custom.sync();
    expect(exp.exposed.map((e) => e.name)).toEqual(["ext_my_projects"]);
    const names = await s.names();
    expect(names).toContain("ext_my_projects");
    expect(base.every((n) => names.includes(n))).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.changed()).toBeGreaterThan(0); // إشعار tools/list_changed

    const res = await s.call("ext_my_projects");
    expect(res.isError).toBe(false);
    expect(res.data.provenance).toBe("computed");
    expect(Array.isArray(res.data.result.projects)).toBe(true);

    const file = JSON.parse(readFileSync(path.join(process.env.MONTAGE_WORKSPACE!, "extensions", "mcp-exposure.json"), "utf-8"));
    expect(file.exposed[0].name).toBe("ext_my_projects");

    // التعطيل/الحذف ينعكس
    await svc.setEnabled("tool", "my_projects", false);
    await s.custom.sync();
    expect(await s.names()).not.toContain("ext_my_projects");
    await s.client.close();
  });

  it("revalidates on every call: revoking permission blocks an already-listed tool", async () => {
    const s = await setup();
    await publish(projectsTool, ["project.read"]);
    await svc.setEnabled("tool", "my_projects", true);
    await s.custom.sync();
    expect((await s.call("ext_my_projects")).isError).toBe(false);
    await svc.grantPermissions("tool", "my_projects", []); // سحب المنح دون مزامنة
    const r = await s.call("ext_my_projects");
    expect(r.isError).toBe(true);
    expect(r.err?.code).toBe("APPROVAL_DENIED");
    await s.client.close();
  });

  it("rejects invalid arguments and unknown fields (never silently dropped)", async () => {
    const s = await setup();
    await publish(addTitleTool, ["project.write"]);
    await svc.setEnabled("tool", "add_title", true, { acknowledgeUntested: true });
    await s.custom.sync();
    const messageOf = async (args: Record<string, unknown>) => {
      const r = await s.client.callTool({ name: "ext_add_title", arguments: args }).catch((e: Error) => ({ isError: true, content: [{ text: e.message }] }));
      return { isError: !!(r as { isError?: boolean }).isError, text: String(((r as { content: { text: string }[] }).content[0] ?? { text: "" }).text) };
    };
    const extra = await messageOf({ projectId: "p", text: "t", evil: "rm -rf" });
    expect(extra.isError).toBe(true);
    expect(extra.text).toMatch(/evil|unrecognized|Unrecognized|غير/);
    const missing = await messageOf({ projectId: "p" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/text|required|Invalid/i);
    const tooLong = await messageOf({ projectId: "p", text: "x".repeat(500) });
    expect(tooLong.isError).toBe(true);
    await s.client.close();
  });

  it("write tools require elicitation approval and are undoable edits", async () => {
    const proj = await createProject({ name: "p", aspect: "16:9" });
    // بلا دعم elicitation ⇒ رفض
    const s1 = await setup(false);
    await publish(addTitleTool, ["project.write"]);
    await svc.setEnabled("tool", "add_title", true, { acknowledgeUntested: true });
    await s1.custom.sync();
    const denied = await s1.call("ext_add_title", { projectId: proj.id, text: "مرحبا" });
    expect(denied.err?.code).toBe("APPROVAL_DENIED");
    expect((await getProject(proj.id)).textOverlays.length).toBe(0);
    await s1.client.close();

    // مع elicitation ⇒ يُنفَّذ بعد الموافقة
    const s2 = await setup(true);
    await s2.custom.sync();
    const done = await s2.call("ext_add_title", { projectId: proj.id, text: "مرحبا" });
    expect(done.isError).toBe(false);
    expect(s2.approvals.length).toBe(1);
    expect((await getProject(proj.id)).textOverlays.length).toBe(1);
    await s2.client.close();
  });

  it("list_custom_tools reports registry state and skipped tools", async () => {
    const s = await setup();
    await publish(projectsTool, ["project.read"]);
    await svc.setEnabled("tool", "my_projects", true);
    await svc.grantPermissions("tool", "my_projects", []);
    const r = await s.call("list_custom_tools");
    expect(r.data.exposed.length).toBe(0);
    expect(r.data.skipped[0].reason).toMatch(/صلاحيات غير ممنوحة/);
    expect(r.data.registry[0].id).toBe("my_projects");
    await s.client.close();
  });
});
