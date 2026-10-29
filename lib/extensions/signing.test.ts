// توقيع Ed25519: صحة، كشف العبث، قائمة الثقة، وسياسة الاشتراط عند الاستيراد.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { generateKeyPair, signPackage, signatureStatus, signatureGate } from "./signing";
import { parsePackage, withIntegrity, type ExtensionPackage } from "./manifest";
import * as svc from "./service";

const tmp = mkdtempSync(path.join(os.tmpdir(), "montage_sig_"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const base = () => {
  const r = parsePackage({
    format: "montage-extension", formatVersion: 1, kind: "skill", files: {},
    manifest: { kind: "skill", id: "signed_one", version: "1.0.0", name: "موقّعة", description: "اختبار", category: "text", permissions: [], input: { type: "object", properties: { text: { type: "string", maxLength: 50 } } }, execution: { type: "native", entry: "text_stats" } },
  });
  if (!r.ok) throw new Error(r.errors.join());
  return { ...r.pkg, manifest: withIntegrity(r.pkg.manifest, r.pkg.files) } as ExtensionPackage;
};

beforeEach(() => {
  process.env.MONTAGE_WORKSPACE = path.join(tmp, `ws_${Math.random().toString(36).slice(2)}`);
  delete process.env.MONTAGE_EXT_REQUIRE_SIGNED;
  delete process.env.MONTAGE_EXT_TRUSTED_KEYS;
});

describe("package signing", () => {
  it("signs, verifies, and detects tampering of manifest or files", async () => {
    const k = generateKeyPair();
    const pkg = signPackage(base(), k.privateKeyPem, "owner");
    expect((await signatureStatus(pkg)).status).toBe("untrusted"); // صالح لكن المفتاح غير موثوق
    const tampered = { ...pkg, manifest: { ...pkg.manifest, name: "معدَّلة" } } as ExtensionPackage;
    expect((await signatureStatus(tampered)).status).toBe("invalid");
    const filesTampered = { ...pkg, files: { "instructions.md": "x" } };
    expect((await signatureStatus(filesTampered)).status).toBe("invalid");
    const other = signPackage(base(), generateKeyPair().privateKeyPem);
    const swapped = { ...pkg, signature: { ...other.signature!, publicKey: pkg.signature!.publicKey } };
    expect((await signatureStatus(swapped)).status).toBe("invalid"); // توقيع مفتاح آخر
    expect((await signatureStatus(base())).status).toBe("unsigned");
  });

  it("trusts only keys in the owner's list (outside the workspace)", async () => {
    const k = generateKeyPair();
    const keys = path.join(tmp, "trusted.json");
    writeFileSync(keys, JSON.stringify({ keys: [{ name: "me", publicKey: k.publicKey }] }));
    process.env.MONTAGE_EXT_TRUSTED_KEYS = keys;
    const st = await signatureStatus(signPackage(base(), k.privateKeyPem));
    expect(st).toMatchObject({ status: "trusted", signer: "me" });
    process.env.MONTAGE_EXT_TRUSTED_KEYS = path.join(process.env.MONTAGE_WORKSPACE!, "trusted.json");
    await expect(signatureStatus(signPackage(base(), k.privateKeyPem))).resolves.toMatchObject({ status: "untrusted" }); // قائمة داخل مساحة العمل تُتجاهل
  });

  it("REQUIRE_SIGNED blocks unsigned/untrusted imports but not local creation", async () => {
    const k = generateKeyPair();
    process.env.MONTAGE_EXT_REQUIRE_SIGNED = "1";
    expect(await signatureGate(base(), "imported")).toMatch(/غير موقّعة/);
    expect(await signatureGate(signPackage(base(), k.privateKeyPem), "imported")).toMatch(/غير موجود في قائمة/);
    expect(await signatureGate(base(), "user")).toBeNull();
    await expect(svc.saveExtension(base(), { origin: "imported", update: false })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const keys = path.join(tmp, "t2.json");
    writeFileSync(keys, JSON.stringify({ keys: [{ name: "me", publicKey: k.publicKey }] }));
    process.env.MONTAGE_EXT_TRUSTED_KEYS = keys;
    const ok = await svc.saveExtension(signPackage(base(), k.privateKeyPem), { origin: "imported", update: false });
    expect(ok.summary.signature).toBe("trusted");
    // سحب الثقة لاحقاً يوقف التفعيل والكشف فوراً
    await svc.runExtension("skill", "signed_one", { text: "a" }, { mode: "test" });
    process.env.MONTAGE_EXT_TRUSTED_KEYS = "";
    await expect(svc.setEnabled("skill", "signed_one", true)).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
  });

  it("a tampered signed package is always rejected, even for local origin", async () => {
    const pkg = signPackage(base(), generateKeyPair().privateKeyPem);
    const bad = { ...pkg, manifest: { ...pkg.manifest, description: "تغيّرت بعد التوقيع" } };
    await expect(svc.saveExtension(bad, { origin: "user", update: false })).rejects.toBeTruthy();
  });
});
