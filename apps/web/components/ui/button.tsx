import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[background-color,border-color,color,transform,box-shadow,filter] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "btn-brand-gradient border-0 font-bold hover:-translate-y-px active:translate-y-0",
        secondary:
          "border border-[var(--border)] bg-[var(--card)]/80 text-[var(--foreground)] backdrop-blur-md hover:-translate-y-px hover:border-[var(--primary)]/35 hover:bg-[var(--primary)]/10",
        ghost:
          "border-0 bg-transparent text-[var(--foreground)] hover:bg-[var(--primary)]/10 hover:text-[var(--foreground)]",
        success:
          "border border-[var(--primary)]/35 bg-[var(--primary)]/10 text-canton hover:border-[var(--primary)]/45 hover:bg-[var(--primary)]/15",
        muted:
          "border border-[var(--border)] bg-[var(--muted)]/40 text-[var(--muted-foreground)] cursor-default",
        dashed:
          "border border-dashed border-[var(--border)] bg-transparent text-[var(--muted-foreground)] cursor-not-allowed",
        danger:
          "border border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)] hover:border-[var(--danger)]/45 hover:bg-[var(--danger)]/15",
        icon:
          "border-0 bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
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
