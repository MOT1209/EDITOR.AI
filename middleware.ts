// /api: حارس Host/Origin ثم المصادقة (إن فُرضت) — lib/server/host-guard.ts و lib/server/auth.ts.
// الصفحات: CSP بـ nonce لكل طلب (T-11) — lib/server/csp.ts.
import { NextResponse, type NextRequest } from "next/server";
import { guardApiRequest } from "@/lib/server/api-guard";
import { API_CSP, buildPageCsp, makeNonce } from "@/lib/server/csp";

/** صفحة: nonce جديد يُمرَّر لـ Next عبر ترويسات الطلب (يضعه على سكربتاته) ويُفرض على الاستجابة. */
function pageWithCsp(req: NextRequest): NextResponse {
  const nonce = makeNonce();
  const csp = buildPageCsp(nonce, process.env.NODE_ENV !== "production");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) return pageWithCsp(req);
  const res = guardApiRequest(req) ?? NextResponse.next();
  res.headers.set("Content-Security-Policy", API_CSP);
  return res;
}

export const config = {
  matcher: [
    // كل /api عدا مسارات الرفع الكبيرة (STREAMING_API_ROUTES في lib/server/api-guard.ts): middleware كان
    // سيبتر أجسامها عند 10MB، وهي تستدعي guardApiRequest بنفسها. القائمة هنا حرفية (Next يتطلب ثوابت).
    "/api/((?!(?:ffmpeg/probe|assets/upload|assets/audio|ai/transcribe|ai/transcribe-words|agents/ceo|agents/pipeline)$).*)",
    // كل الصفحات عدا الأصول الثابتة (لا تحتاج nonce) — ومنها طلبات prefetch.
    "/((?!api/|_next/static|_next/image|favicon.ico).*)",
  ],
};
