import { forwardRef } from "react";
import { cn } from "@/lib/utils/utils";

/**
 * Unified Card — the single surface primitive for the dApp.
 *
 * Replaces the ~14 hand-rolled card class strings
 * (`rounded-2xl border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl ...`)
 * with one token-driven glass card.
 *
 * `interactive` adds the gradient-hairline frame + lift-on-hover glow,
 * matching the landing page's premium feel.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Enable gradient-hairline frame + hover lift. */
  interactive?: boolean;
  /** Remove the default ring (for nested cards). */
  bare?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, bare, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "glass-card rounded-2xl",
        !bare && "ring-1 ring-[var(--border)]",
        interactive && "glass-card-hover gradient-hairline",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1 p-6 pb-0", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6", className)} {...props} />;
}
