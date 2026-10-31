import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { GET } from "@/app/api/diagnostics/route";
import { scrub } from "@/lib/server/scrub";

describe("diagnostics route never exposes disk paths", () => {
  it("scrub: source_path → basename, project root → '.'", () => {
    const out = scrub({ source_path: "/srv/a/b/video.mp4", errors: [`failed at ${process.cwd()}/x/y`] });
    expect(out.source_path).toBe("video.mp4");
    expect(JSON.stringify(out)).not.toContain(process.cwd());
  });
  it("GET ?job= and list return scrubbed manifests; bad ids are 400", async () => {
    const dir = path.join(process.cwd(), ".montage_ai", "pipeline", "job_999000111");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ source_path: `${process.cwd()}/.montage_ai/uploads/zz.mp4`, status: "ok" }));
    try {
      const one = await (await GET(new NextRequest("http://localhost/api/diagnostics?job=job_999000111"))).json();
      expect(one.manifest.source_path).toBe("zz.mp4");
      const list = JSON.stringify(await (await GET(new NextRequest("http://localhost/api/diagnostics"))).json());
      expect(list).not.toContain(process.cwd());
      expect((await GET(new NextRequest("http://localhost/api/diagnostics?job=../../etc"))).status).toBe(400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
