// عزل البرامج الخارجية: اختبار حقيقي (عملية فعلية) — يُتخطّى إن لم تتوفر user namespaces.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { detectSandboxes, planSandbox } from "./sandbox";
import { runExternal } from "./external";

const det = detectSandboxes();
const CAN = !!det.bwrap || det.unshare;
let tmp: string;
let ws: string;

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "montage_sbx_"));
  ws = path.join(tmp, "ws");
  mkdirSync(ws, { recursive: true });
  writeFileSync(path.join(ws, "secret.txt"), "TOP-SECRET");
  writeFileSync(
    path.join(tmp, "probe.py"),
    `import json, os, socket, sys
json.load(sys.stdin)
s = socket.socket(); s.settimeout(2)
net = s.connect_ex(("1.1.1.1", 53))
print(json.dumps({"net": net, "secret_visible": os.path.exists(${JSON.stringify(path.join(ws, "secret.txt"))})}))
`
  );
  writeFileSync(path.join(tmp, "allow.json"), JSON.stringify({ entries: { probe: { command: "/usr/bin/python3", args: [path.join(tmp, "probe.py")], permissions: [] } } }));
  process.env.MONTAGE_WORKSPACE = ws;
  process.env.MONTAGE_EXT_EXTERNAL = "1";
  process.env.MONTAGE_EXT_ALLOWLIST = path.join(tmp, "allow.json");
});
afterAll(() => {
  delete process.env.MONTAGE_EXT_SANDBOX;
  rmSync(tmp, { recursive: true, force: true });
});

const opts = { timeoutMs: 15000, maxOutputBytes: 10000 };

describe("external sandbox", () => {
  it("refuses to run when policy requires isolation that is unavailable", () => {
    process.env.MONTAGE_EXT_SANDBOX = det.bwrap ? "unshare" : "bwrap"; // ما لا يتوفر
    if (det.bwrap && det.unshare) return; // كلاهما متاح: لا حالة رفض لاختبارها هنا
    expect(() => planSandbox("/usr/bin/python3", [])).toThrowError(/غير متاح/);
  });

  it.runIf(CAN)("blocks network and hides the workspace (real process)", async () => {
    process.env.MONTAGE_EXT_SANDBOX = "auto";
    const r = await runExternal("probe", {}, opts);
    const out = r.output as { net: number; secret_visible: boolean };
    expect(out.net).not.toBe(0); // الاتصال فشل
    expect(out.secret_visible).toBe(false);
    expect(r.sandbox).toMatch(/^(bwrap|unshare)/);
  });

  it.runIf(CAN)("shows the contrast: with isolation off the same program sees the workspace", async () => {
    process.env.MONTAGE_EXT_SANDBOX = "none";
    const r = await runExternal("probe", {}, opts);
    expect((r.output as { secret_visible: boolean }).secret_visible).toBe(true);
    expect(r.sandbox).toMatch(/^none/);
  });
});
