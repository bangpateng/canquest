"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { Wrench, RefreshCw } from "lucide-react";

/**
 * Status mode maintenance (bentuk sama dengan MaintenanceStatus backend).
 */
interface MaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  estimatedEnd: string | null;
}

// Poll ringan (jaring pengaman). Reaksi utama tetap event `cq:maintenance` (503).
// Sebelumnya 15s → membanjiri endpoint /api/public/maintenance dan memicu 429
// di Vercel serverless. 120s cukup untuk fallback tanpa banjir.
const POLL_INTERVAL_MS = 120_000;

/**
 * Gate reaktif mode maintenance.
 *
 * Dipasang di <Providers>, jadi aktif di seluruh app. Saat maintenance ON:
 *   - Polling GET /api/public/maintenance tiap 15s.
 *   - Dengarkan event `cq:maintenance` dari apiFetch (503) → tampil INSTAN.
 *   - Render overlay full-screen yang memblokir SEMUA interaksi.
 *   - No-op di path /admin (admin panel tetap hidup untuk recovery).
 *
 * Catatan: ini lapisan UX. Penegakan keamanan ada di backend (MaintenanceGuard 503).
 * Untuk direct URL/refresh, middleware.ts men-rewrite ke /maintenance (anti-flash).
 */
export function MaintenanceGate() {
  const pathname = usePathname();
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Jangan pernah aktif di area admin.
  const isAdmin = pathname?.startsWith("/admin");

  useEffect(() => {
    if (isAdmin) {
      setStatus(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const check = async () => {
      try {
        const res = await fetch("/api/public/maintenance", {
          cache: "no-store",
          signal: controller.signal,
        });
        // 429 = rate-limited by platform; diam (fail-open) supaya tidak spam
        // console. Polling berikutnya / event cq:maintenance tetap jalan.
        if (!res.ok) return;
        const data = (await res.json()) as MaintenanceStatus;
        if (!cancelled) setStatus(data.enabled ? data : null);
      } catch {
        /* ignore — polling berikutnya / event handler */
      }
    };

    // Reaksi INSTAN: apiFetch dispatch event saat terima 503 maintenance.
    const onEvent = () => {
      void check();
    };
    window.addEventListener("cq:maintenance", onEvent);

    void check();
    const timer = window.setInterval(check, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener("cq:maintenance", onEvent);
      window.clearInterval(timer);
    };
  }, [isAdmin]);

  if (!mounted || isAdmin || !status) return null;

  return createPortal(
    <MaintenanceOverlay status={status} />,
    document.body,
  );
}

function MaintenanceOverlay({ status }: { status: MaintenanceStatus }) {
  const end = status.estimatedEnd ? new Date(status.estimatedEnd) : null;
  const endValid = end && !Number.isNaN(end.getTime());

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--background)]/95 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Maintenance mode"
    >
      {/* Cegah scroll body di belakang overlay */}
      <style>{`body { overflow: hidden !important; }`}</style>

      <div className="mx-auto w-full max-w-md px-6 text-center">
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

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-canton px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" />
          Coba lagi
        </button>
      </div>
    </div>
  );
}
