// ====================================================================
// توقيع الحزم (Ed25519) — إثبات هوية الناشر، فوق بصمة SHA-256 التي تكشف العبث فقط.
//
// الرسالة الموقَّعة: "montage-extension-v1:" + digest (SHA-256 للبيان بلا integrity/signature + الملفات).
// التوقيع حقل على مستوى الحزمة (package.signature)، خارج البيان، فلا يغيّر البصمة.
// الثقة بيد المالك: ملف مفاتيح موثوقة خارج مساحة العمل (MONTAGE_EXT_TRUSTED_KEYS)؛ توقيع صالح بمفتاح
// غير موثوق = «untrusted». MONTAGE_EXT_REQUIRE_SIGNED=1 يشترط «trusted» لأي حزمة مستوردة (حفظاً وتفعيلاً وكشفاً).
// ⚠️ لا يُثبت التوقيع أن الحزمة آمنة، بل أن ناشراً يملك المفتاح وقّعها ولم تُعدَّل بعدها.
// ====================================================================
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "crypto";
import { promises as fsp } from "fs";
import path from "path";
import { z } from "zod";
import { EngineError } from "@/lib/engine/errors";
import { workspaceRoot } from "@/lib/engine/store";
import { isPathInside } from "@/lib/server/ffmpeg-export";
import { computeDigest, type ExtensionPackage } from "./manifest";

export const SignatureSchema = z.object({
  algorithm: z.literal("ed25519"),
  /** مفتاح عام SPKI-DER بترميز base64 */
  publicKey: z.string().regex(/^[A-Za-z0-9+/=]{40,120}$/),
  signature: z.string().regex(/^[A-Za-z0-9+/=]{80,100}$/),
  signedAt: z.string().max(40).optional(),
  signer: z.string().max(80).optional(),
});
export type PackageSignature = z.infer<typeof SignatureSchema>;

export type SignatureStatus = "unsigned" | "invalid" | "untrusted" | "trusted";

const PREFIX = "montage-extension-v1:";
const message = (pkg: Pick<ExtensionPackage, "manifest" | "files">) => Buffer.from(PREFIX + computeDigest(pkg.manifest, pkg.files));

export const fingerprint = (publicKeyB64: string) => createHash("sha256").update(Buffer.from(publicKeyB64, "base64")).digest("hex").slice(0, 16);

export function generateKeyPair(): { publicKey: string; privateKeyPem: string; fingerprint: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { publicKey: pub, privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), fingerprint: fingerprint(pub) };
}

export function signPackage(pkg: ExtensionPackage, privateKeyPem: string, signer?: string): ExtensionPackage {
  let key;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new EngineError("INVALID_INPUT", "مفتاح خاص غير صالح (PEM/PKCS8 Ed25519 مطلوب)");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new EngineError("INVALID_INPUT", "المفتاح ليس Ed25519");
  const publicKey = createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
  const sig = sign(null, message(pkg), key).toString("base64");
  return { ...pkg, signature: { algorithm: "ed25519", publicKey, signature: sig, signedAt: new Date().toISOString(), ...(signer ? { signer } : {}) } };
}

function validCrypto(pkg: ExtensionPackage): boolean {
  const s = pkg.signature;
  if (!s) return false;
  try {
    const pub = createPublicKey({ key: Buffer.from(s.publicKey, "base64"), format: "der", type: "spki" });
    return verify(null, message(pkg), pub, Buffer.from(s.signature, "base64"));
  } catch {
    return false;
  }
}

export interface TrustedKey {
  name: string;
  publicKey: string;
}

/** قائمة المفاتيح الموثوقة من ملف المالك (خارج مساحة العمل، وإلا تُتجاهل مع خطأ). */
export async function loadTrustedKeys(): Promise<TrustedKey[]> {
  const file = process.env.MONTAGE_EXT_TRUSTED_KEYS;
  if (!file) return [];
  const abs = path.resolve(file);
  if (isPathInside(abs, workspaceRoot())) throw new EngineError("FORBIDDEN_PATH", "ملف المفاتيح الموثوقة يجب أن يقع خارج مساحة العمل");
  try {
    const raw = JSON.parse(await fsp.readFile(abs, "utf-8")) as { keys?: Array<Partial<TrustedKey>> };
    return (raw.keys ?? []).filter((k): k is TrustedKey => typeof k.name === "string" && typeof k.publicKey === "string");
  } catch {
    throw new EngineError("DEPENDENCY_MISSING", "تعذّرت قراءة MONTAGE_EXT_TRUSTED_KEYS", 'الصيغة: {"keys":[{"name":"…","publicKey":"<base64 spki>"}]}');
  }
}

export async function signatureStatus(pkg: ExtensionPackage): Promise<{ status: SignatureStatus; fingerprint?: string; signer?: string }> {
  if (!pkg.signature) return { status: "unsigned" };
  const fp = fingerprint(pkg.signature.publicKey);
  if (!validCrypto(pkg)) return { status: "invalid", fingerprint: fp };
  const trusted = (await loadTrustedKeys().catch(() => [])).find((k) => k.publicKey === pkg.signature!.publicKey);
  return trusted ? { status: "trusted", fingerprint: fp, signer: trusted.name } : { status: "untrusted", fingerprint: fp, signer: pkg.signature.signer };
}

export const requireSigned = () => process.env.MONTAGE_EXT_REQUIRE_SIGNED === "1";

/** سبب الرفض إن كانت السياسة تشترط توقيعاً موثوقاً ولم يتحقق (يُطبَّق على الحزم المستوردة)، وإلا null. */
export async function signatureGate(pkg: ExtensionPackage, origin: "user" | "imported"): Promise<string | null> {
  const s = await signatureStatus(pkg);
  if (s.status === "invalid") return "توقيع الحزمة غير صالح (محتوى معدَّل أو توقيع تالف)";
  if (origin === "imported" && requireSigned() && s.status !== "trusted") {
    return s.status === "unsigned" ? "السياسة تشترط حزماً موقّعة بمفتاح موثوق (MONTAGE_EXT_REQUIRE_SIGNED) والحزمة غير موقّعة" : "الحزمة موقّعة بمفتاح غير موجود في قائمة المالك الموثوقة";
  }
  return null;
}
