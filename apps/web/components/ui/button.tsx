import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_0_20px_rgb(var(--canton-rgb)/0.18)] hover:brightness-105 hover:shadow-[0_0_24px_rgb(var(--canton-rgb)/0.28)] active:scale-[0.99]",
        secondary:
          "border border-[var(--border)] bg-[var(--card)]/80 text-[var(--foreground)] hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10",
        ghost:
          "text-[var(--foreground)] hover:bg-[var(--primary)]/10 hover:text-[var(--foreground)]",
        success:
          "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:border-emerald-500/45 hover:bg-emerald-500/15",
        muted:
          "border border-[var(--border)] bg-[var(--muted)]/40 text-[var(--muted-foreground)] cursor-default",
        dashed:
          "border border-dashed border-[var(--border)] bg-transparent text-[var(--muted-foreground)] cursor-not-allowed",
        danger:
          "border border-red-500/30 bg-red-500/10 text-red-300 hover:border-red-500/45 hover:bg-red-500/15",
      },
      size: {
        default: "h-11 px-5 text-sm",
        sm: "h-9 px-4 text-xs",
        lg: "h-12 px-8 text-base",
        block: "h-11 w-full px-5 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);

Button.displayName = "Button";
