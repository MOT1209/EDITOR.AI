"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

const DiagnosticsDashboard = dynamic(
  () => import("@/components/diagnostics/DiagnosticsDashboard"),
  {
    ssr: false,
    loading: () => (
      <div className="h-screen w-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
          <p className="text-zinc-400 text-sm">جاري تحميل لوحة التشخيص...</p>
        </div>
      </div>
    ),
  }
);

function Inner() {
  const job = useSearchParams().get("job") ?? undefined;
  return <DiagnosticsDashboard initialJobId={job} />;
}

export default function DiagnosticsPage() {
  // Next 15: searchParams في الصفحات غير متزامنة؛ نقرأ الاستعلام في العميل ضمن Suspense.
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
