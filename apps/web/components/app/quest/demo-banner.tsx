import { Info } from "lucide-react";

export function DemoBanner() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/5 bg-[var(--primary)]/8 px-4 py-3 text-sm font-medium text-slate-100">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
      <div>
        <span className="font-semibold">UI preview</span>
        <span className="text-slate-400">
          {" "}
          — numbers, quests, and history below are mocked for layout testing only.
          They do not sync with your account or Canton.
        </span>
      </div>
    </div>
  );
}
