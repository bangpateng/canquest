import type { ReactNode } from "react";
import { inputClass, surfaceCardClass } from "@/lib/ui-tokens";
import { cn } from "@/lib/utils";

/** @deprecated Use inputClass from @/lib/ui-tokens or Input from @/components/ui/input */
export const authInputClass = inputClass;

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
        "relative overflow-hidden p-8 shadow-[0_0_40px_rgb(0_0_0/0.35)]",
        surfaceCardClass,
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
