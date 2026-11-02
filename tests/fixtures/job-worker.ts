// عامل اختبار: ينشئ مهمة «running» مع عامل فرعي (يحاكي ffmpeg) ومخرَج جزئي، ثم ينتظر حتى يُقتل بـ SIGKILL.
// الاستخدام: node --import tsx tests/fixtures/job-worker.ts <artifactPath>
import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { jobsStore } from "@/lib/server/jobs-store";

const artifact = process.argv[2];
writeFileSync(artifact, "partial");
// عامل يتيم محتمل: سطر أوامره يتضمن مسار المخرَج (كما في ffmpeg الحقيقي).
const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)", artifact], { stdio: "ignore" });
const job = jobsStore.create("export", "تصدير يُقتل");
jobsStore.update(job.id, { progress: 42 });
jobsStore.attachWorker(job.id, worker.pid!, artifact);
process.stdout.write(`${job.id} ${worker.pid}\n`);
setInterval(() => {}, 1 << 30);
