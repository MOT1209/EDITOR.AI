import { NextRequest, NextResponse } from "next/server";
import { listActions } from "@/lib/extensions/actions";
import { externalEnabled } from "@/lib/extensions/external";
import { PERMISSIONS, PLATFORM_VERSION, CATEGORIES } from "@/lib/extensions/manifest";
import { listNativeEntries } from "@/lib/extensions/native";
import * as svc from "@/lib/extensions/service";
import { errorResponse, parseKind, readBody } from "@/lib/server/ext-api";
import { builtinMcpTools, readExposure } from "@/lib/server/ext-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/extensions?kind=skills|tools&q=&category=&tag=&label=&status=
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const kind = parseKind(sp.get("kind") ?? "skills");
    const items = await svc.listExtensions(kind, {
      q: sp.get("q") ?? undefined, category: sp.get("category") ?? undefined, tag: sp.get("tag") ?? undefined,
      label: sp.get("label") ?? undefined, status: sp.get("status") ?? undefined,
    });
    const meta = {
      platformVersion: PLATFORM_VERSION, permissions: PERMISSIONS, categories: CATEGORIES, externalEnabled: externalEnabled(),
      actions: listActions(), native: listNativeEntries(),
    };
    const extra =
      kind === "skill"
        ? { builtins: svc.listBuiltinSkills() }
        : { builtins: await builtinMcpTools(), exposure: await readExposure() };
    return NextResponse.json({ kind, items, meta, ...extra });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/extensions { op:"validate"|"create"|"import", kind?, package }
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const kind = body.kind ? parseKind(String(body.kind)) : undefined;
    const pkg = body.package;
    switch (body.op) {
      case "validate":
        return NextResponse.json(await svc.validateRaw(pkg, kind));
      case "create":
        return NextResponse.json(await svc.saveExtension(pkg, { kind, origin: "user", update: false, note: "إنشاء" }), { status: 201 });
      case "import":
        return NextResponse.json(await svc.saveExtension(pkg, { kind, origin: "imported", update: body.update === true, note: "استيراد" }), { status: 201 });
      default:
        return NextResponse.json({ error: "op غير معروفة", code: "INVALID_INPUT" }, { status: 400 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
