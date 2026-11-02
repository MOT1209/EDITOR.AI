import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "MontageAI - محرر فيديو بالذكاء الاصطناعي",
  description:
    "محرر فيديو احترافي يعمل بالكامل بالذكاء الاصطناعي - قص، ترجمة، تحسين صوت، ألوان، وتصدير بضغطة زر. للاستخدام الشخصي والمحلي.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // قراءة الترويسات تجعل كل الصفحات تُرندر عند الطلب — شرط لأن يضع Next الـ nonce (CSP من middleware)
  // على سكربتاته؛ الصفحات المبنية مسبقاً ستحمل سكربتات بلا nonce فيحجبها المتصفح.
  await headers();
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-bg text-ink overflow-hidden">{children}</body>
    </html>
  );
}
