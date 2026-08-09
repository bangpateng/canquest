import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/utils";

/**
 * Badge / pill — unified replacement for the ~8 inline badge families found
 * across the dApp (eyebrow pill, canton pill, status colors, count chips).
 *
 * Default radius is rounded-full. Use size="sm" for tight inline labels.
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1 font-semibold tracking-wider transition-colors",
  {
    variants: {
      variant: {
        default:
          "rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase text-[var(--muted-foreground)] sm:text-xs",
        brand:
          "rounded-full border border-canton-muted bg-canton-subtle px-2.5 py-1 text-[10px] uppercase text-canton sm:text-xs",
        success:
          "rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300",
        danger:
          "rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-0.5 text-xs text-red-300",
        warn:
          "rounded-full border border-orange-500/30 bg-orange-500/15 px-2.5 py-0.5 text-xs text-orange-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
