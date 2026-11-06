import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require_ = createRequire(import.meta.url);

describe("security headers (next.config.js)", () => {
  it("sets clickjacking / sniffing / referrer / framing protections on every route", async () => {
    const cfg = require_("../../next.config.js");
    const rules = await cfg.headers();
    expect(rules[0].source).toBe("/:path*");
    const h = Object.fromEntries(rules[0].headers.map((x: { key: string; value: string }) => [x.key, x.value]));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    // CSP لم تعد ثابتة هنا: middleware يضعها لكل طلب بـ nonce (tests/security/csp.test.ts).
    expect(h["Content-Security-Policy"]).toBeUndefined();
    // الإنتاج بلا eval (يُتحقق منه حياً عبر curl على next start في تقرير المعالجة)
    expect(cfg.poweredByHeader).toBe(false);
  });
});
