// تشغيل عمليات خارجية بأمان: مصفوفة وسائط (بلا shell)، مهلة، إلغاء، وسقف للمخرجات.
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { resolveFfmpegPath } from "@/lib/server/ffmpeg-export";
import { EngineError } from "./errors";

export interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  cwd?: string;
  /** أقصى بايتات تُحفظ من stdout (الباقي يُهمل ويُعلَّم truncated). */
  maxStdoutBytes?: number;
  /** stdout كـ Buffer خام (لبيانات PCM) بدل نص. */
  binaryStdout?: boolean;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: Buffer) => void;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stdoutBuffer: Buffer;
  stderr: string;
  truncated: boolean;
}

const STDERR_TAIL = 64 * 1024;

export function runProcess(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new EngineError("CANCELLED", "أُلغيت العملية قبل البدء"));
      return;
    }
    const proc = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true });
    const maxOut = opts.maxStdoutBytes ?? 8 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let outBytes = 0;
    let truncated = false;
    let stderr = "";
    let settled = false;
    let reason: "timeout" | "cancel" | null = null;

    const kill = (why: "timeout" | "cancel") => {
      if (reason) return;
      reason = why;
      proc.kill("SIGKILL");
    };
    const timer = setTimeout(() => kill("timeout"), opts.timeoutMs);
    const onAbort = () => kill("cancel");
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout.on("data", (b: Buffer) => {
      opts.onStdout?.(b);
      if (outBytes >= maxOut) {
        truncated = true;
        return;
      }
      const take = b.subarray(0, maxOut - outBytes);
      chunks.push(take);
      outBytes += take.length;
      if (take.length < b.length) truncated = true;
    });
    proc.stderr.on("data", (b: Buffer) => {
      stderr = (stderr + b.toString("utf-8")).slice(-STDERR_TAIL);
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    proc.on("error", (err) =>
      finish(() =>
        reject(new EngineError("DEPENDENCY_MISSING", `تعذّر تشغيل ${path.basename(cmd)}: ${err.message}`, "تأكد من التثبيت أو اضبط المسار في البيئة."))
      )
    );
    proc.on("close", (code) =>
      finish(() => {
        if (reason === "timeout") reject(new EngineError("TIMEOUT", `تجاوزت ${path.basename(cmd)} المهلة (${Math.round(opts.timeoutMs / 1000)}s)`));
        else if (reason === "cancel") reject(new EngineError("CANCELLED", "أُلغيت العملية"));
        else {
          const buf = Buffer.concat(chunks);
          resolve({ code, stdout: opts.binaryStdout ? "" : buf.toString("utf-8"), stdoutBuffer: buf, stderr, truncated });
        }
      })
    );
  });
}

export function ffmpegPath(): string {
  return resolveFfmpegPath();
}

/** ffprobe بجوار ffmpeg إن وُجد، وإلا من PATH (أو FFPROBE_PATH). */
export function ffprobePath(): string {
  if (process.env.FFPROBE_PATH && existsSync(process.env.FFPROBE_PATH)) return process.env.FFPROBE_PATH;
  const ff = resolveFfmpegPath();
  if (ff !== "ffmpeg") {
    const cand = path.join(path.dirname(ff), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (existsSync(cand)) return cand;
  }
  return "ffprobe";
}
