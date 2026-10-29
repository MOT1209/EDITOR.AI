// ====================================================================
// موافقة المستخدم على العمليات المكلفة/المدمّرة (تصدير، تطبيق خطة، حذف، مزوّد مدفوع).
//
// السياسة (يضبطها الإنسان في إعداد عميل MCP — لا يستطيع النموذج تغييرها):
//   MONTAGE_MCP_APPROVAL=elicit (افتراضي) → سؤال المستخدم عبر MCP elicitation؛
//                                           عميل بلا دعم elicitation ⇒ رفض مع إرشاد.
//   MONTAGE_MCP_APPROVAL=auto             → موافقة تلقائية (المستخدم فوّض مسبقاً).
//   MONTAGE_MCP_APPROVAL=deny             → رفض كل العمليات المحمية.
// ====================================================================
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EngineError } from "@/lib/engine/errors";

export type ApprovalPolicy = "elicit" | "auto" | "deny";

export interface ApprovalRequest {
  action: string;
  summary: string;
}

/** دالة موافقة قابلة للحقن (للاختبار أو لطبقة تفاعل أخرى). ترجع true عند الموافقة. */
export type Approver = (req: ApprovalRequest) => Promise<boolean>;

export function approvalPolicy(): ApprovalPolicy {
  const v = (process.env.MONTAGE_MCP_APPROVAL || "elicit").toLowerCase();
  return v === "auto" || v === "deny" ? v : "elicit";
}

export function elicitationApprover(server: McpServer): Approver {
  return async ({ action, summary }) => {
    const policy = approvalPolicy();
    if (policy === "auto") return true;
    if (policy === "deny") {
      throw new EngineError("APPROVAL_DENIED", `العملية «${action}» معطّلة بسياسة MONTAGE_MCP_APPROVAL=deny`);
    }
    const caps = server.server.getClientCapabilities();
    if (!caps?.elicitation) {
      throw new EngineError(
        "APPROVAL_DENIED",
        `العملية «${action}» تتطلب موافقة المستخدم، وعميل MCP الحالي لا يدعم طلب الموافقة (elicitation)`,
        "اطلب من المستخدم تنفيذها بنفسه، أو أن يضبط MONTAGE_MCP_APPROVAL=auto في إعداد الخادم إن أراد التفويض المسبق."
      );
    }
    const res = await server.server.elicitInput({
      mode: "form",
      message: `موافقة مطلوبة — ${action}\n\n${summary}`,
      requestedSchema: {
        type: "object",
        properties: {
          approve: { type: "boolean", title: "أوافق على التنفيذ", description: summary.slice(0, 300) },
        },
        required: ["approve"],
      },
    });
    return res.action === "accept" && res.content?.approve === true;
  };
}

export async function requireApproval(approver: Approver, req: ApprovalRequest): Promise<void> {
  const ok = await approver(req);
  if (!ok) {
    throw new EngineError("APPROVAL_DENIED", `رفض المستخدم العملية «${req.action}»`, "لا تُعِد المحاولة دون طلب صريح من المستخدم.");
  }
}
