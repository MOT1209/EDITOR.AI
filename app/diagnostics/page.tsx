import dynamic from "next/dynamic";

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

export default function DiagnosticsPage({
  searchParams,
}: {
  searchParams: { job?: string };
}) {
  return <DiagnosticsDashboard initialJobId={searchParams.job} />;
}
