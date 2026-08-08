import dynamic from "next/dynamic";

const ShortsStudio = dynamic(() => import("@/components/shorts/ShortsStudio"), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a12]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-12 w-12 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
        <p className="text-zinc-400 text-sm">جاري تحميل استوديو Shorts...</p>
      </div>
    </div>
  ),
});

export default function ShortsPage() {
  return <ShortsStudio />;
}
