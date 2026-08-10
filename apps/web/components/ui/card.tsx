import { forwardRef } from "react";
import { cn } from "@/lib/utils/utils";

/**
 * Unified Card — single flat surface primitive (Vercel/GitHub style).
 *
 * Design: solid background, one thin border, subtle shadow. No blur, no glow,
 * no gradient hairlines. Clean and quiet.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Subtle hover lift + border highlight. Use on actionable/linked cards. */
  interactive?: boolean;
  /** Remove the default border (for nested cards on tinted backgrounds). */
  bare?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, bare, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl bg-[var(--card)]",
        !bare && "border border-[var(--border)]",
        interactive &&
          "transition-colors hover:border-[var(--primary)]/30",
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
      className={cn("flex flex-col gap-1 p-5 pb-0", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
