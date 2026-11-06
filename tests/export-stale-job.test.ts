import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ensureExportDir, writeJobStatus } from "@/lib/server/ffmpeg-export";
import { GET } from "@/app/api/export/status/[id]/route";

describe("stale export job after server restart", () => {
  it("a 'running' status with no live controller is reported as failed (no resume)", async () => {
    await ensureExportDir();
    const id = `job_${Date.now()}_9`;
    await writeJobStatus({ id, status: "running", progress: 40 });
    const res = await GET(new NextRequest(`http://localhost/api/export/status/${id}`), { params: Promise.resolve({ id }) });
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.message).toContain("توقفت");
  });
});
