// عامل اختبار: ينفّذ N تعديلات على مشروع (عملية منفصلة تحاكي خادم MCP بجانب Next).
// الاستخدام: tsx tests/fixtures/mutate-worker.ts <projectId> <n> <tag>
import { mutateProject } from "@/lib/engine/store";

async function main() {
  const [projectId, nRaw, tag] = process.argv.slice(2);
  const n = Number(nRaw);
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      mutateProject(projectId, "test_rename", `${tag}-${i}`, (p) => ({ project: { ...p, name: `${p.name}|` }, result: null }))
    )
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
