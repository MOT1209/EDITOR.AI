import { NextRequest, NextResponse } from "next/server";
import { importRemoteImage } from "@/lib/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only Pexels' own CDN hosts are allowed — this endpoint fetches a
// server-supplied URL, so an open allowlist would make it an SSRF proxy.
const ALLOWED_HOSTS = [/(^|\.)pexels\.com$/i];

function isAllowedHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return false;
    return ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const imageUrl = body?.imageUrl;
  if (typeof imageUrl !== "string" || !isAllowedHost(imageUrl)) {
    return NextResponse.json({ error: "رابط صورة غير صالح" }, { status: 400 });
  }

  try {
    const { path: filePath, size } = await importRemoteImage(imageUrl);
    return NextResponse.json({ path: filePath, size });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "فشل استيراد الصورة";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
