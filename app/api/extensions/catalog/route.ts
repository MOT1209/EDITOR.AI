import { NextRequest, NextResponse } from "next/server";
import { installFromCatalog, listCatalog } from "@/lib/extensions/catalog";
import { errorResponse, readBody } from "@/lib/server/ext-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/extensions/catalog → فهرس الاكتشاف المحلي مع حالة التثبيت/التحديث
export async function GET() {
  try {
    return NextResponse.json({ source: "local", entries: await listCatalog() });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST { key, op:"install"|"update" } → يثبّت/يحدّث (لا يفعّل ولا يمنح صلاحيات)
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    if (body.op !== "install" && body.op !== "update") return NextResponse.json({ error: "op: install|update", code: "INVALID_INPUT" }, { status: 400 });
    const r = await installFromCatalog(String(body.key ?? ""), body.op);
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
