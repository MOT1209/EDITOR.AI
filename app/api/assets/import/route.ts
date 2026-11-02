import path from "path";
import { parseJsonBody } from "@/lib/server/request";
import { importImageBody } from "@/lib/server/schemas";
import { assetRef } from "@/lib/server/media-ref";
import { NextRequest, NextResponse } from "next/server";
import { importRemoteImage, isAllowedImportUrl } from "@/lib/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// القائمة المسموحة (pexels.com فقط) وإعادة فحصها بعد كل تحويل في lib/server/assets.ts — وإلا صار المسار وكيل SSRF.

export async function POST(req: NextRequest) {
  const parsedBody = await parseJsonBody(req, importImageBody);
  if (!parsedBody.ok) return parsedBody.response;
  const imageUrl = parsedBody.data.imageUrl;
  if (!isAllowedImportUrl(imageUrl)) {
    return NextResponse.json({ error: "رابط صورة غير صالح" }, { status: 400 });
  }

  try {
    const { path: filePath, size } = await importRemoteImage(imageUrl);
    return NextResponse.json({ ref: assetRef(path.basename(filePath)), size });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "فشل استيراد الصورة";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
