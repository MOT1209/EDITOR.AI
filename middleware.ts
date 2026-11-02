// /api: حارس Host/Origin ثم المصادقة (إن فُرضت) — lib/server/host-guard.ts و lib/server/auth.ts.
// الصفحات: CSP بـ nonce لكل طلب (T-11) — lib/server/csp.ts.
import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/lib/server/host-guard";
import { checkAuth } from "@/lib/server/auth";
import { isAllowed, rateLimit, rateLimitPerMin } from "@/lib/server/auth-roles";
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
  const res = apiMiddleware(req);
  res.headers.set("Content-Security-Policy", API_CSP);
  return res;
}

function apiMiddleware(req: NextRequest): NextResponse {
  const verdict = checkRequest(req.headers.get("host"), req.headers.get("origin"));
  if (!verdict.ok) {
    return NextResponse.json({ error: `مرفوض: ${verdict.reason}` }, { status: 403 });
  }
  // /api/session يتحقق من الرمز بنفسه (تسجيل الدخول يسبق امتلاك كوكي الجلسة).
  if (req.nextUrl.pathname === "/api/session") return NextResponse.next();
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
  const limit = rateLimitPerMin();
  if (!rateLimit(auth.tokenId, limit)) {
    return NextResponse.json({ error: "تجاوزت حد الطلبات في الدقيقة" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    // كل الصفحات عدا الأصول الثابتة (لا تحتاج nonce) — ومنها طلبات prefetch.
    "/((?!api/|_next/static|_next/image|favicon.ico).*)",
  ],
};
