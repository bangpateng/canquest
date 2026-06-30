import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wrench, RefreshCw } from "lucide-react";
import { internalApiBase } from "@/lib/api/internal-api-url";

export const metadata: Metadata = {
  title: "Maintenance — CanQuest",
  description: "CanQuest sedang dalam pemeliharaan.",
  robots: { index: false, follow: false },
};

// Revalidate tiap 5 detik — konsisten dengan cache backend/middleware.
export const revalidate = 5;

interface MaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  estimatedEnd: string | null;
}

async function getMaintenance(): Promise<MaintenanceStatus> {
  const off: MaintenanceStatus = {
    enabled: false,
    title: "",
    message: "",
    estimatedEnd: null,
  };
  try {
    const res = await fetch(`${internalApiBase()}/public/maintenance`, {
      cache: "no-store",
    });
    if (!res.ok) return off;
    return (await res.json()) as MaintenanceStatus;
  } catch {
    return off;
  }
}

/**
 * Halaman maintenance mandiri. Middleware men-rewrite SEMUA path non-admin ke
 * sini saat maintenance ON. Bila status ternyata OFF (mis. cache basi saat
 * toggle baru dimatikan), redirect ke home — jangan tampilkan layar kosong.
 */
export default async function MaintenancePage() {
  const status = await getMaintenance();
  if (!status.enabled) {
    redirect("/");
  }

  const end = status.estimatedEnd ? new Date(status.estimatedEnd) : null;
  const endValid = end && !Number.isNaN(end.getTime());

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-canton-subtle ring-1 ring-inset ring-[var(--border)]">
          <Wrench className="h-9 w-9 animate-pulse text-canton" />
        </div>

        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-canton">
          Maintenance
        </p>

        <h1 className="type-section-title mb-3 text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
          {status.title}
        </h1>

        <p className="mb-6 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {status.message}
        </p>

        {endValid && (
          <p className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)]/60 px-4 py-3 text-sm text-[var(--foreground)]">
            <span className="text-[var(--muted-foreground)]">
              Estimasi selesai:{" "}
            </span>
            <span className="font-semibold">
              {end.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </p>
        )}

        <form action="/maintenance" className="inline-block">
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-canton px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" />
            Coba lagi
          </button>
        </form>
      </div>
    </main>
  );
}
