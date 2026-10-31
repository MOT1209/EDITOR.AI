/** @type {import('next').NextConfig} */

// ترويسات أمان أساسية. CSP هنا «خفيفة» عمداً (frame-ancestors/base-uri/form-action/object-src فقط):
// الواجهة تستخدم سكربتات Next المضمّنة وروابط blob: للمعاينة، وCSP صارمة تتطلب nonce — انظر خارطة الطريق.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
