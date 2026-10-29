// يطبّق حارس Host/Origin على كل مسارات /api (انظر lib/server/host-guard.ts).
import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/lib/server/host-guard";

export function middleware(req: NextRequest) {
  const verdict = checkRequest(req.headers.get("host"), req.headers.get("origin"));
  if (!verdict.ok) {
    return NextResponse.json({ error: `مرفوض: ${verdict.reason}` }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
