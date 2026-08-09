import { forwardRef } from "react";
import { inputClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Textarea — companion to <Input>, same token-driven styling.
 * Replaces the one inline textarea in wallet-actions (memo field).
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(inputClass, "resize-none font-mono", className)}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
