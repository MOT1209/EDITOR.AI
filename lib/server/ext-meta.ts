// معلومات تشغيلية للواجهة: أدوات MCP المدمجة (من خادم حقيقي في الذاكرة) وسجل التعرّض الفعلي.
import { promises as fsp } from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMontageServer } from "@/mcp/server";
import { exposureFile, type Exposure } from "@/mcp/custom-tools";

export interface BuiltinTool {
  name: string;
  title?: string;
  description?: string;
  readOnly: boolean;
  destructive: boolean;
  inputSchema: unknown;
  outputSchema?: unknown;
}

let cache: BuiltinTool[] | null = null;

/** يستعلم عن tools/list لخادم مدمج بلا أدوات مخصّصة — القائمة الحقيقية لا نسخة مكتوبة يدوياً. */
export async function builtinMcpTools(): Promise<BuiltinTool[]> {
  if (cache) return cache;
  const server = createMontageServer({ customTools: false });
  const client = new Client({ name: "montage-ui", version: "1" }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const { tools } = await client.listTools();
    cache = tools
      .filter((t) => !["list_custom_tools", "refresh_custom_tools"].includes(t.name))
      .map((t) => ({
        name: t.name, title: t.title, description: t.description, readOnly: t.annotations?.readOnlyHint === true,
        destructive: t.annotations?.destructiveHint === true, inputSchema: t.inputSchema, outputSchema: t.outputSchema,
      }));
    return cache;
  } finally {
    await client.close();
  }
}

export interface ExposureInfo extends Partial<Exposure> {
  /** هل ما زالت عملية خادم MCP التي كتبت السجل حيّة؟ (على نفس الجهاز) */
  running: boolean;
  present: boolean;
}

export async function readExposure(): Promise<ExposureInfo> {
  try {
    const exp = JSON.parse(await fsp.readFile(exposureFile(), "utf-8")) as Exposure;
    let running = false;
    try {
      process.kill(exp.pid, 0);
      running = true;
    } catch {
      running = false;
    }
    return { ...exp, running, present: true };
  } catch {
    return { running: false, present: false };
  }
}
