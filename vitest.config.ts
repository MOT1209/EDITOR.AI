import { defineConfig } from "vitest/config";
import path from "path";

// إعداد Vitest: منطق نقي (Node) — لا DOM حالياً. alias "@" يطابق tsconfig.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "mcp/**/*.test.ts", "tests/**/*.test.ts"],
    // اختبارات FFmpeg الحقيقية أطول من الافتراضي (5s).
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
