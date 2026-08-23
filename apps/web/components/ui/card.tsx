import { forwardRef } from "react";
import { cn } from "@/lib/utils/utils";

/**
 * Unified Card — clean light surface primitive.
 *
 * Design: solid card background, hairline border, soft layered shadow.
 * `bare` collapses to a solid `--card-solid` panel (for nested cards).
 * `interactive` adds a hover lift + border highlight + brand glow.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Subtle hover lift + border highlight + glow. Use on actionable/linked cards. */
  interactive?: boolean;
  /** Solid panel (no glass blur) for nested cards on tinted backgrounds. */
  bare?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, bare, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-[1.25rem]",
        bare
          ? "bg-[var(--card-solid)]"
          : "border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]",
        interactive &&
          "transition-[border-color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease)] hover:-translate-y-0.5 hover:border-[var(--primary)]/32 hover:shadow-[var(--shadow-card-hover)]",
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
