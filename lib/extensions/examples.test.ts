// حزم examples/extensions يجب أن تبقى صالحة دائماً (الأمثلة الموثّقة لا تتعفّن).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { readPackageDir } from "./package-dir";
import { validateRaw } from "./service";

const dir = path.resolve("examples/extensions");

describe("documented example packages", () => {
  for (const name of readdirSync(dir)) {
    it(`${name} is valid`, async () => {
      const full = path.join(dir, name);
      const raw = statSync(full).isDirectory() ? await readPackageDir(full) : JSON.parse(readFileSync(full, "utf-8"));
      const r = await validateRaw(raw);
      expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
      expect(r.ok).toBe(true);
    });
  }
});
