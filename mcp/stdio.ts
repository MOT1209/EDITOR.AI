// نقطة دخول خادم MCP عبر stdio (للعملاء المحليين: Claude Desktop/Code، Cursor...).
// stdout محجوز لبروتوكول JSON-RPC — أي سجل يذهب إلى stderr فقط.
//   التشغيل: pnpm mcp   (من جذر المستودع)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMontageServer, SERVER_NAME, SERVER_VERSION } from "./server";
import { mediaRoots, workspaceRoot } from "@/lib/engine/store";
import { approvalPolicy } from "./approval";

// حماية: أي console.log عرضي من شيفرة مشتركة يُحوَّل إلى stderr كي لا يفسد البروتوكول.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

async function main() {
  const server = createMontageServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[${SERVER_NAME} ${SERVER_VERSION}] جاهز عبر stdio — workspace=${workspaceRoot()} roots=${mediaRoots().join(",")} approval=${approvalPolicy()}`
  );
  const shutdown = async () => {
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(`[${SERVER_NAME}] فشل التشغيل:`, e);
  process.exit(1);
});
