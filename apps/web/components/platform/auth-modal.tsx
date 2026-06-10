"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { X } from "lucide-react";

export function AuthModal({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams();
  const auth = sp.get("auth");
  const [open, setOpen] = useState(false);
  useEffect(() => { if (auth === "login" || auth === "register") setOpen(true); }, [auth]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-6">
        <button onClick={() => setOpen(false)} className="absolute top-3 right-3 p-1 rounded-md hover:bg-[var(--muted)]"><X className="h-4 w-4 text-[var(--muted-foreground)]" /></button>
        {children}
      </div>
    </div>
  );
}