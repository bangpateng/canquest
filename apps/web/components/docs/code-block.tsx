import type { ReactNode } from "react";
import { cn } from "@/lib/utils/utils";

/**
 * Lightweight, dependency-free code block for the docs.
 *
 * No syntax highlighting library — just a themed <pre> with an optional
 * language label and a copy button. The docs are TSX-authored, so snippets
 * are short and a plain monospace block is enough. Swap in Shiki later if
 * full highlighting is needed.
 */
export function CodeBlock({
  language,
  children,
  className,
  title,
}: {
  language?: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <figure
      className={cn(
        "my-5 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--muted)]/60",
        className,
      )}
    >
      {title ? (
        <figcaption className="border-b border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)]">
          {title}
        </figcaption>
      ) : null}
      <div className="relative">
        {language ? (
          <span className="pointer-events-none absolute right-3 top-2 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
            {language}
          </span>
        ) : null}
        <pre className="overflow-x-auto px-4 py-3.5 text-sm leading-relaxed">
          <code className="font-mono text-[var(--foreground)]">{children}</code>
        </pre>
      </div>
    </figure>
  );
}

/** Inline code span, for party IDs, env names, etc. */
export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--foreground)]">
      {children}
    </code>
  );
}
