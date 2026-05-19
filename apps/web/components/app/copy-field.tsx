"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

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
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-[var(--muted-foreground)]">{label}</p>
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-xs font-mono text-[var(--foreground)]">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          aria-label="Copy"
        >
          {copied ? (
            <Check className="h-4 w-4 shrink-0 text-canton-muted" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
