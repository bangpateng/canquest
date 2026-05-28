import type { ReactNode } from "react";
import { LandingShell } from "@/components/landing/landing-shell";
import { cn } from "@/lib/utils";

type LandingSectionProps = {
  id?: string;
  children: ReactNode;
  variant?: "default" | "muted";
  shellClassName?: string;
  className?: string;
};

export function LandingSection({
  id,
  children,
  variant = "default",
  shellClassName,
  className,
}: LandingSectionProps) {
  return (
    <section
      id={id}
      className={cn("relative scroll-mt-20 border-b border-[var(--border)]", className)}
    >
      {variant === "muted" ? (
        <div className="pointer-events-none absolute inset-0 bg-[var(--muted)]/25" aria-hidden />
      ) : null}
      <LandingShell
        className={cn("relative py-14 sm:py-16 md:py-20 lg:py-24", shellClassName)}
      >
        {children}
      </LandingShell>
    </section>
  );
}
