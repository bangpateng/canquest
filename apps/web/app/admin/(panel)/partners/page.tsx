"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, Plus, RefreshCw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AdminPartnersPanel } from "@/components/admin/admin-partners-panel";

export default function AdminPartnersPage() {
  const [partners, setPartners] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/partners", { cache: "no-store" });
      if (!res.ok) {
        setError("Failed to load partners.");
        return;
      }
      setPartners(await res.json());
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-brand text-[var(--foreground)]">
            <Globe className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Ecosystem partners</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Directory shown on /ecosystem — profiles are off-chain and safe to
              edit anytime.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "ml-auto gap-2")}
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
        <a href="/admin/partners?new=1" className={cn(buttonVariants({ size: "sm" }), "gap-2")}>
          <Plus className="h-4 w-4" /> New partner
        </a>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : (
        <AdminPartnersPanel partners={partners ?? []} onChanged={load} />
      )}
    </div>
  );
}
