"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-sm font-medium text-slate-400">{label}</p>
      <div className="flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-white/5 bg-[var(--muted)]/50 px-4 py-3">
        <code className="min-w-0 flex-1 break-all text-sm font-mono font-medium leading-relaxed text-slate-100 sm:truncate sm:break-normal">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className={iconButtonClass("h-9 w-9 shrink-0 text-slate-100")}
          aria-label="Copy"
        >
          {copied ? (
            <Check className="h-5 w-5 shrink-0 text-canton" />
          ) : (
            <Copy className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}
