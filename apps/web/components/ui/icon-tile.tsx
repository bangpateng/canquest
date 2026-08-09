import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/utils";

/**
 * IconTile — unified container for an icon inside a rounded tile.
 *
 * Replaces the ~6 ad-hoc icon-container families (sizes h-7→h-16, mixed
 * radius/colors). Three sizes, four tones, all token-driven.
 */
export const iconTileVariants = cva(
  "flex shrink-0 items-center justify-center rounded-xl ring-1",
  {
    variants: {
      size: {
        sm: "h-9 w-9",
        md: "h-11 w-11",
        lg: "h-14 w-14",
      },
      tone: {
        brand: "bg-canton-subtle ring-[var(--primary)]/15",
        muted: "bg-white/5 ring-white/10",
        success: "bg-emerald-500/15 ring-emerald-500/25",
        danger: "bg-red-500/15 ring-red-500/25",
        warn: "bg-orange-500/15 ring-orange-500/25",
      },
    },
    defaultVariants: { size: "md", tone: "brand" },
  },
);

export interface IconTileProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof iconTileVariants> {}

export function IconTile({ className, size, tone, ...props }: IconTileProps) {
  return (
    <span
      className={cn(iconTileVariants({ size, tone }), className)}
      {...props}
    />
  );
}

/** Icon size mapping — the lucide icon inside a tile. */
export const iconTileIconSize = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
} as const;
