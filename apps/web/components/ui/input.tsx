import { forwardRef } from "react";
import { inputClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));

Input.displayName = "Input";

export { inputClass };
