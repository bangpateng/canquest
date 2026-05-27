"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { inputClass } from "@/lib/ui-tokens";
import { cn } from "@/lib/utils";

export function PasswordInput({
  id,
  name = "password",
  label,
  placeholder = "••••••••",
  autoComplete = "current-password",
  required = true,
  minLength,
  className,
  inputClassName,
}: {
  id?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  autoComplete?: "current-password" | "new-password";
  required?: boolean;
  minLength?: number;
  className?: string;
  inputClassName?: string;
}) {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? name;

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label htmlFor={inputId} className="text-xs font-medium text-[var(--muted-foreground)]">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          className={cn(inputClass, "bg-[var(--muted)]/80 pr-11", inputClassName)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/10 hover:text-[var(--foreground)]"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
