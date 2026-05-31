import type { ReactNode } from "react";
import { LandingShell } from "@/components/landing/landing-shell";
import { cn } from "@/lib/utils/utils";

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
      className={cn(
        "scroll-mt-20 border-b border-[var(--border)]",
        variant === "muted" && "bg-[var(--muted)]/15",
        className,
      )}
    >
      <LandingShell className={cn("py-12 md:py-16", shellClassName)}>{children}</LandingShell>
    </section>
  );
}
