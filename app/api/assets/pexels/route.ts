import { NextRequest, NextResponse } from "next/server";
import { getPexelsKey } from "@/lib/server/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  photographer: string;
  src: { medium: string; large2x: string; original: string };
}

export async function GET(req: NextRequest) {
  const key = getPexelsKey(req);
  if (!key) {
    return NextResponse.json(
      { error: "أضف مفتاح Pexels (PEXELS_API_KEY) لتفعيل مكتبة الصور", configured: false, photos: [] },
      { status: 200 }
    );
  }

  const query = req.nextUrl.searchParams.get("query") || "";
  if (!query.trim()) {
    return NextResponse.json({ configured: true, photos: [] });
  }

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=24`,
      { headers: { Authorization: key } }
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Pexels API error: ${text}` }, { status: res.status });
    }
    const data = await res.json();
    const photos = ((data.photos || []) as PexelsPhoto[]).map((p) => ({
      id: String(p.id),
      thumbnail: p.src.medium,
      fullUrl: p.src.large2x || p.src.original,
      photographer: p.photographer,
      width: p.width,
      height: p.height,
    }));
    return NextResponse.json({ configured: true, photos });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
