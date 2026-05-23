import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const authInputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/80 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]/40 focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function AuthCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-[0_0_40px_rgb(0_0_0/0.35)]",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/50 to-transparent" />
      <div className="relative space-y-1">
        <h1 className="type-page-title">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-sm text-[var(--muted-foreground)]">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
