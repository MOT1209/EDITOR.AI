// أداة سطر أوامر لإدارة حزم الإضافات (بنفس منطق الواجهة وMCP):
//   pnpm ext validate <مجلد|ملف.json>
//   pnpm ext install  <مجلد|ملف.json> [--update]     ← يثبّت معطّلاً (التفعيل من الواجهة بعد الاختبار والمنح)
//   pnpm ext list [skills|tools]
//   pnpm ext export <skills|tools> <id> [out.json]
//   pnpm ext keygen <name>                            ← مفتاح Ed25519: <name>.key.pem (سرّي!) + <name>.pub.json
//   pnpm ext sign <مجلد|ملف> --key <name>.key.pem [--signer اسم] [--out ملف.json]
//   pnpm ext verify <مجلد|ملف>                       ← حالة التوقيع مقابل MONTAGE_EXT_TRUSTED_KEYS
import { promises as fsp } from "fs";
import path from "path";
import { readPackageDir } from "@/lib/extensions/package-dir";
import * as svc from "@/lib/extensions/service";
import { parsePackage, withIntegrity, type ExtensionKind } from "@/lib/extensions/manifest";
import { generateKeyPair, signPackage, signatureStatus } from "@/lib/extensions/signing";

async function load(target: string) {
  const st = await fsp.stat(target);
  return st.isDirectory() ? readPackageDir(target) : JSON.parse(await fsp.readFile(target, "utf-8"));
}
const kindOf = (s: string | undefined): ExtensionKind => (s === "tools" || s === "tool" ? "tool" : "skill");

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case "validate": {
      const r = await svc.validateRaw(await load(a));
      for (const i of r.issues) console.log(`${i.level === "error" ? "✗" : "⚠"} [${i.code}] ${i.message}`);
      console.log(r.ok ? "✓ الحزمة صالحة" : "✗ الحزمة غير صالحة");
      process.exit(r.ok ? 0 : 1);
    }
    case "install": {
      const r = await svc.saveExtension(await load(a), { origin: "imported", update: process.argv.includes("--update"), note: "تثبيت من CLI" });
      console.log(`✓ ثُبّتت ${r.summary.kind}:${r.summary.id}@${r.summary.version} (معطّلة — فعّلها من /extensions بعد الاختبار ومنح الصلاحيات)`);
      return;
    }
    case "list": {
      for (const e of await svc.listExtensions(kindOf(a))) console.log(`${e.status.padEnd(12)} ${e.label.padEnd(12)} ${e.id}@${e.version}  ${e.name}`);
      return;
    }
    case "export": {
      const pkg = await svc.exportExtension(kindOf(a), b);
      const out = process.argv[5] ?? `${pkg.manifest.id}-${pkg.manifest.version}.montage-${pkg.kind}.json`;
      await fsp.writeFile(path.resolve(out), JSON.stringify(pkg, null, 2));
      console.log(`✓ صُدّرت إلى ${out}`);
      return;
    }
    case "keygen": {
      if (!a || !/^[A-Za-z0-9_-]{1,40}$/.test(a)) throw new Error("الاستخدام: pnpm ext keygen <name>");
      const k = generateKeyPair();
      await fsp.writeFile(`${a}.key.pem`, k.privateKeyPem, { mode: 0o600, flag: "wx" });
      await fsp.writeFile(`${a}.pub.json`, JSON.stringify({ keys: [{ name: a, publicKey: k.publicKey }] }, null, 2), { flag: "wx" });
      console.log(`✓ ${a}.key.pem (سرّي — لا يُرفع إلى git) و ${a}.pub.json (أضف محتواه إلى ملف MONTAGE_EXT_TRUSTED_KEYS خارج مساحة العمل)\n  بصمة المفتاح: ${k.fingerprint}`);
      return;
    }
    case "sign": {
      const flag = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
      const keyFile = flag("--key");
      if (!keyFile) throw new Error("--key <ملف pem> مطلوب");
      const raw = (await load(a)) as Record<string, unknown>;
      const parsed = parsePackage({ format: "montage-extension", formatVersion: 1, ...(raw.format ? raw : { kind: (raw.manifest as { kind?: string })?.kind, manifest: raw.manifest, files: raw.files }) });
      if (!parsed.ok) throw new Error(`حزمة غير صالحة: ${parsed.errors.join("؛ ")}`);
      const pkg = { ...parsed.pkg, manifest: withIntegrity(parsed.pkg.manifest, parsed.pkg.files) };
      const signed = signPackage(pkg, await fsp.readFile(keyFile, "utf-8"), flag("--signer"));
      const out = flag("--out") ?? `${pkg.manifest.id}-${pkg.manifest.version}.signed.json`;
      await fsp.writeFile(out, JSON.stringify(signed, null, 2));
      console.log(`✓ وُقّعت → ${out}`);
      return;
    }
    case "verify": {
      const raw = (await load(a)) as Record<string, unknown>;
      const parsed = parsePackage({ format: "montage-extension", formatVersion: 1, ...(raw.format ? raw : { kind: (raw.manifest as { kind?: string })?.kind, manifest: raw.manifest, files: raw.files }) });
      if (!parsed.ok) throw new Error(`حزمة غير صالحة: ${parsed.errors.join("؛ ")}`);
      const st = await signatureStatus(parsed.pkg);
      console.log(`التوقيع: ${st.status}${st.fingerprint ? ` (بصمة ${st.fingerprint})` : ""}${st.signer ? ` — ${st.signer}` : ""}`);
      process.exit(st.status === "trusted" ? 0 : 1);
    }
    default:
      console.log("الاستخدام: pnpm ext <validate|install|list|export|keygen|sign|verify> …");
      process.exit(2);
  }
}
main().catch((e) => {
  console.error(`✗ ${e.message}${e.hint ? `\nتلميح: ${e.hint}` : ""}`);
  process.exit(1);
});
