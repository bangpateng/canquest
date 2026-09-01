import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/utils";

const spinnerVariants = cva("animate-spin shrink-0", {
  variants: {
    size: {
      xs: "h-3 w-3",
      sm: "h-3.5 w-3.5",
      md: "h-4 w-4",
      lg: "h-5 w-5",
      xl: "h-6 w-6",
      "2xl": "h-8 w-8",
    },
    tone: {
      brand: "text-canton",
      muted: "text-[var(--muted-foreground)]",
      inherit: "text-current",
    },
  },
  defaultVariants: { size: "md", tone: "brand" },
});

export type LoadingSpinnerProps = React.ComponentProps<typeof Loader2> &
  VariantProps<typeof spinnerVariants>;

/** Satu bentuk spinner untuk seluruh CanQuest (ikon Loader2 + warna brand). */
export function LoadingSpinner({ className, size, tone, ...props }: LoadingSpinnerProps) {
  return (
    <Loader2
      className={cn(spinnerVariants({ size, tone }), className)}
      aria-hidden
      {...props}
    />
  );
}

type PageLoadingProps = {
  className?: string;
  minHeight?: string;
};

/** Loading halaman penuh / section (tengah). */
export function PageLoading({
  className,
  minHeight = "min-h-[40vh]",
}: PageLoadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3",
        minHeight,
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <LoadingSpinner size="2xl" />
    </div>
  );
}


