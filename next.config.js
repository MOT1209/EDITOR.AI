/** @type {import('next').NextConfig} */

// ترويسات أمان. CSP تمنع تحميل سكربتات خارجية وأي اتصال خارج الأصل (تسريب المفاتيح عبر XSS)، لكنها تُبقي
// 'unsafe-inline' للسكربتات لأن Next يضمّن سكربتات التهيئة؛ CSP بـ nonce كاملة تتطلب middleware لكل صفحة (مؤجلة).
// connect-src يسمح بـ huggingface.co فقط لزر «اختبار التوكن» في إعدادات API.
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data:",
  `connect-src 'self' blob: https://huggingface.co${isDev ? " ws:" : ""}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
