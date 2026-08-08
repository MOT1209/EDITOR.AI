import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@/components/editor/Editor"), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen flex items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="h-12 w-12 rounded-full border-2 border-brand/30 border-t-brand animate-spin" />
        <p className="text-ink-soft text-sm">جاري تحميل المحرر...</p>
      </div>
    </div>
  ),
});

import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <Link
        href="/shorts"
        className="fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-600/90 hover:bg-violet-500 text-white text-xs font-medium shadow-lg backdrop-blur transition"
      >
        ✨ استوديو Shorts
      </Link>
      <Editor />
    </>
  );
}
