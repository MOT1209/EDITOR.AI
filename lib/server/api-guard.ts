// حارس /api المشترك: Host/Origin ← المصادقة ← الأدوار ← تحديد المعدل.
// يستعمله middleware لكل /api، وتستدعيه مباشرةً المسارات ذات الأجسام الكبيرة المستثناة من middleware
// (STREAMING_API_ROUTES): Next 15.5 ينسخ جسم أي طلب يمرّ بـ middleware في الذاكرة بسقف 10MB ويقطع
// الباقي ⇒ رفع فيديو أكبر من 10MB كان يُبتر ثم يُرفض. هذه المسارات تبث الجسم إلى القرص بنفسها.
import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/lib/server/host-guard";
import { checkAuth } from "@/lib/server/auth";
import { isAllowed, rateLimit, rateLimitPerMin } from "@/lib/server/auth-roles";

/** مسارات تستقبل ملفات كبيرة — مستثناة من middleware، وتستدعي guardApiRequest أول سطر في كل معالج. */
export const STREAMING_API_ROUTES = [
  "/api/ffmpeg/probe",
  "/api/assets/upload",
  "/api/assets/audio",
  "/api/ai/transcribe",
  "/api/ai/transcribe-words",
  "/api/agents/ceo",
  "/api/agents/pipeline",
] as const;

/** null = مسموح؛ وإلا استجابة الرفض الجاهزة. */
export function guardApiRequest(req: NextRequest): NextResponse | null {
  const verdict = checkRequest(req.headers.get("host"), req.headers.get("origin"));
  if (!verdict.ok) {
    return NextResponse.json({ error: `مرفوض: ${verdict.reason}` }, { status: 403 });
  }
  // /api/session يتحقق من الرمز بنفسه (تسجيل الدخول يسبق امتلاك كوكي الجلسة).
  if (req.nextUrl.pathname === "/api/session") return null;
  const auth = checkAuth({
    authorization: req.headers.get("authorization"),
    xToken: req.headers.get("x-montage-token"),
    cookie: req.headers.get("cookie"),
  });
  if (!auth.ok) {
    return NextResponse.json(
      { error: `مرفوض: ${auth.reason}` },
      { status: auth.status, headers: auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined }
    );
  }
  if (!isAllowed(auth.role, req.method, req.nextUrl.pathname)) {
    return NextResponse.json({ error: `مرفوض: دور «${auth.role}» لا يملك صلاحية هذه العملية` }, { status: 403 });
  }
  if (!rateLimit(auth.tokenId, rateLimitPerMin())) {
    return NextResponse.json({ error: "تجاوزت حد الطلبات في الدقيقة" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  return null;
}
