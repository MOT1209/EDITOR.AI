import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/extensions/service";
import { apiKeyOf, errorResponse, parseKind, readBody, requestSensitiveApproval, requireSensitiveApproval, uiApprover } from "@/lib/server/ext-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ kind: string; id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  try {
    return NextResponse.json(await svc.getExtensionDetail(parseKind(params.kind), params.id));
  } catch (e) {
    return errorResponse(e);
  }
}

// PUT: إصدار جديد (يجب أن يكون أعلى من كل الإصدارات المحفوظة)
export async function PUT(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  try {
    const kind = parseKind(params.kind);
    const body = await readBody(req);
    const manifest = (body.package as { manifest?: { id?: string } } | undefined)?.manifest;
    if (manifest?.id !== params.id) return NextResponse.json({ error: "معرّف الحزمة لا يطابق المسار", code: "INVALID_INPUT" }, { status: 400 });
    return NextResponse.json(await svc.saveExtension(body.package, { kind, origin: "user", update: true, note: typeof body.note === "string" ? body.note.slice(0, 200) : "تحديث" }));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  try {
    const body = await readBody(req).catch(() => ({} as Record<string, unknown>));
    const kind = parseKind(params.kind);
    requireSensitiveApproval(`${kind}:${params.id}`, "delete", body.confirm === true);
    await svc.deleteExtension(kind, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST { action: enable|disable|grant|config|activate|duplicate|test|run, ... }
export async function POST(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  try {
    const kind = parseKind(params.kind);
    const id = params.id;
    const body = await readBody(req);
    switch (body.action) {
      case "enable":
        return NextResponse.json(await svc.setEnabled(kind, id, true, { acknowledgeUntested: body.acknowledgeUntested === true }));
      case "disable":
        return NextResponse.json(await svc.setEnabled(kind, id, false));
      case "request_approval":
        // تُستدعى عند فتح نافذة التأكيد: تسجّل موافقة معلّقة لعملية حساسة محددة.
        if (body.for !== "grant" && body.for !== "delete") return NextResponse.json({ error: "for يجب أن تكون grant أو delete", code: "INVALID_INPUT" }, { status: 400 });
        requestSensitiveApproval(`${kind}:${id}`, body.for);
        return NextResponse.json({ ok: true });
      case "grant":
        if (Array.isArray(body.permissions) && body.permissions.length > 0) requireSensitiveApproval(`${kind}:${id}`, "grant", body.confirmed === true);
        return NextResponse.json(await svc.grantPermissions(kind, id, Array.isArray(body.permissions) ? body.permissions.map(String) : []));
      case "config":
        return NextResponse.json(await svc.setConfig(kind, id, (body.config as Record<string, unknown>) ?? {}));
      case "activate":
        return NextResponse.json(await svc.activateVersion(kind, id, String(body.version ?? "")));
      case "duplicate":
        return NextResponse.json(await svc.duplicateExtension(kind, id, String(body.newId ?? "")), { status: 201 });
      case "test":
      case "run": {
        const res = await svc.runExtension(kind, id, body.input ?? {}, {
          mode: body.action, apiKey: apiKeyOf(req), signal: req.signal, approve: uiApprover(body.confirmed === true, `${kind}:${id}`),
        });
        // نتيجة فاشلة تُعاد 200 مع ok:false ليعرضها المختبر (مدة/سجلات/خطأ) — ليست خطأ بروتوكول.
        return NextResponse.json({ ...res, simulated: res.provenance === "simulated", ...(res.provenance === "simulated" ? { warning: "نتيجة محاكاة — ليست تحليلاً حقيقياً" } : {}) });
      }
      default:
        return NextResponse.json({ error: "action غير معروفة", code: "INVALID_INPUT" }, { status: 400 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
