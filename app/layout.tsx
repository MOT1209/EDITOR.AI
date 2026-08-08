import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MontageAI - محرر فيديو بالذكاء الاصطناعي",
  description:
    "محرر فيديو احترافي يعمل بالكامل بالذكاء الاصطناعي - قص، ترجمة، تحسين صوت، ألوان، وتصدير بضغطة زر. للاستخدام الشخصي والمحلي.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-bg text-ink overflow-hidden">{children}</body>
    </html>
  );
}
