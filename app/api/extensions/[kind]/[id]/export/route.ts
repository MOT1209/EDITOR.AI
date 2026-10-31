import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/extensions/service";
import { errorResponse, parseKind } from "@/lib/server/ext-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/extensions/skills/<id>/export?version=1.0.0 → حزمة JSON قابلة للتنزيل والاستيراد
export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const params = await ctx.params;
  try {
    const kind = parseKind(params.kind);
    const pkg = await svc.exportExtension(kind, params.id, req.nextUrl.searchParams.get("version") ?? undefined);
    return new NextResponse(JSON.stringify(pkg, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${pkg.manifest.id}-${pkg.manifest.version}.montage-${kind}.json"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
