// يطبّق حارس Host/Origin ثم المصادقة (إن فُرضت) على كل مسارات /api
// (انظر lib/server/host-guard.ts و lib/server/auth.ts).
import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/lib/server/host-guard";
import { checkAuth } from "@/lib/server/auth";

export function middleware(req: NextRequest) {
  const verdict = checkRequest(req.headers.get("host"), req.headers.get("origin"));
  if (!verdict.ok) {
    return NextResponse.json({ error: `مرفوض: ${verdict.reason}` }, { status: 403 });
  }
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
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
