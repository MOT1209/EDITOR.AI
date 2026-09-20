import { defineConfig } from "vitest/config";
import path from "path";

// إعداد Vitest: منطق نقي (Node) — لا DOM حالياً. alias "@" يطابق tsconfig.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
