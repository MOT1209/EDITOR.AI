// جلسة المتصفح (M3): الرمز يُستبدل بكوكي HttpOnly فلا يقرؤه أي سكربت في الصفحة (حماية من سرقته عبر XSS).
// middleware يستثني هذا المسار من المصادقة فقط (حارس Host/Origin يبقى)؛ التحقق هنا بزمن ثابت مع حد للمحاولات.
import { NextRequest, NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/server/request";
import { sessionBody } from "@/lib/server/schemas";
import { authEnv, checkAuth, isRemoteConfigured } from "@/lib/server/auth";
import { parseTokens, rateLimit, roleForToken } from "@/lib/server/auth-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_COOKIE = "montage_token";
const MAX_AGE_SEC = 7 * 24 * 3600;
const ATTEMPTS_PER_MIN = 10;

function cookie(req: NextRequest, value: string, maxAge: number): string {
  const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function clientKey(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
}

/** GET → هل المصادقة مطلوبة، وهل هذه الجلسة مصادَقة (دون كشف الرمز). */
export async function GET(req: NextRequest) {
  const env = authEnv();
  const { entries } = parseTokens(env.tokens, env.token);
  const required = entries.length > 0 || isRemoteConfigured(env);
  const auth = checkAuth({ authorization: req.headers.get("authorization"), xToken: req.headers.get("x-montage-token"), cookie: req.headers.get("cookie") }, env);
  return NextResponse.json({ required, authenticated: required && auth.ok, role: auth.ok && required ? auth.role : null });
}

/** POST {token} → يتحقق ويضع كوكي HttpOnly؛ الرمز لا يعود في الاستجابة. */
export async function POST(req: NextRequest) {
  if (!rateLimit(`session:${clientKey(req)}`, ATTEMPTS_PER_MIN) || !rateLimit("session:*", ATTEMPTS_PER_MIN * 5)) {
    return NextResponse.json({ error: "محاولات كثيرة، أعد المحاولة بعد دقيقة" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const body = await parseJsonBody(req, sessionBody, { maxBytes: 4096 });
  if (!body.ok) return body.response;
  const env = authEnv();
  const { entries, errors } = parseTokens(env.tokens, env.token);
  if (errors.length > 0) return NextResponse.json({ error: `خطأ تهيئة رموز الوصول: ${errors[0]}` }, { status: 503 });
  if (entries.length === 0) {
    return NextResponse.json({ error: "الخادم لا يفرض رمز وصول (تشغيل محلي)" }, { status: 400 });
  }
  const role = roleForToken(entries, body.data.token.trim());
  if (!role) return NextResponse.json({ error: "رمز الوصول غير صحيح" }, { status: 401 });
  return NextResponse.json({ ok: true, role }, { headers: { "Set-Cookie": cookie(req, body.data.token.trim(), MAX_AGE_SEC) } });
}

/** DELETE → تسجيل الخروج (مسح الكوكي). */
export async function DELETE(req: NextRequest) {
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": cookie(req, "", 0) } });
}
