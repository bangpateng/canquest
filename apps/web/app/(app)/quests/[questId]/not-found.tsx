import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function QuestNotFound() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] px-8 py-12 text-center">
      <p className="font-[family-name:var(--font-space)] text-xl font-semibold text-[var(--foreground)]">
        Quest not found
      </p>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[var(--muted-foreground)]">
        That quest doesn&apos;t exist, was removed, or you don&apos;t have access. Double-check
        the link or open it again from the quest list.
      </p>
      <Link
        href="/quests"
        className="mx-auto mt-8 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--foreground)] px-6 text-[15px] font-semibold text-[var(--background)] transition-colors hover:opacity-90"
      >
        <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
        Back to quests
      </Link>
    </div>
  );
}
