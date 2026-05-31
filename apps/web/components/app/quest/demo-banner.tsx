import { Info } from "lucide-react";

export function DemoBanner() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--primary)]/8 px-3 py-2.5 text-xs text-[var(--foreground)]">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
      <div>
        <span className="font-medium">UI preview</span>
        <span className="text-[var(--muted-foreground)]">
          {" "}
          — numbers, quests, and history below are mocked for layout testing only.
          They do not sync with your account or Canton.
        </span>
      </div>
    </div>
  );
}
