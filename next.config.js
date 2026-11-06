/** @type {import('next').NextConfig} */

// ترويسات أمان عامة. CSP لا تُضبط هنا: middleware يضع لكل صفحة CSP بـ nonce جديد (lib/server/csp.ts)
// ولمسارات /api سياسة default-src 'none' — سياستان متزامنتان كانتا ستتقاطعان.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
];
// HSTS عند النشر عن بُعد فقط (المتصفحات تتجاهلها على http، فلا أثر لها محلياً).
const isRemote = (process.env.MONTAGE_ALLOWED_HOSTS || "").split(",").some((h) => h.trim() !== "");
if (isRemote) securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
