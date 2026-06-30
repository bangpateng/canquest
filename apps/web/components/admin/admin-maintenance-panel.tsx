"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, Power, PowerOff } from "lucide-react";
import { cn } from "@/lib/utils/utils";

interface MaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  estimatedEnd: string | null;
}

const DEFAULT_TITLE = "CanQuest sedang dalam pemeliharaan";
const DEFAULT_MESSAGE =
  "Kami sedang melakukan pembaruan untuk meningkatkan pengalaman Anda. Semua aktivitas dihentikan sementara. Silakan kembali lagi nanti.";

export function AdminMaintenancePanel() {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [estimatedEnd, setEstimatedEnd] = useState("");

  async function refresh() {
    try {
      const res = await fetch("/api/admin/maintenance", { cache: "no-store" });
      if (!res.ok) throw new Error("Gagal memuat status");
      const data = (await res.json()) as MaintenanceStatus;
      setStatus(data);
      setEnabled(data.enabled);
      setTitle(data.title || DEFAULT_TITLE);
      setMessage(data.message || DEFAULT_MESSAGE);
      setEstimatedEnd(
        data.estimatedEnd
          ? toLocalInputValue(data.estimatedEnd)
          : "",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (enabled) {
      const ok = window.confirm(
        "Aktifkan mode maintenance?\n\nSEMUA pengguna non-admin akan langsung diblokir dan melihat layar maintenance. Admin panel tetap bisa diakses.",
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/maintenance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          title: title.trim() || undefined,
          message: message.trim() || undefined,
          estimatedEnd: estimatedEnd
            ? new Date(estimatedEnd).toISOString()
            : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body && typeof body === "object" && "message" in body
            ? String((body as { message: unknown }).message)
            : null) ?? `Gagal menyimpan (${res.status})`,
        );
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat status maintenance…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3",
          status?.enabled
            ? "border-amber-500/40 bg-amber-500/10"
            : "border-emerald-500/30 bg-emerald-500/5",
        )}
      >
        <ShieldAlert
          className={cn(
            "h-5 w-5 shrink-0",
            status?.enabled ? "text-amber-400" : "text-emerald-400",
          )}
        />
        <div className="text-sm">
          <p className="font-semibold text-[var(--foreground)]">
            {status?.enabled
              ? "Maintenance sedang AKTIF"
              : "Maintenance nonaktif"}
          </p>
          <p className="text-[var(--muted-foreground)]">
            {status?.enabled
              ? "Seluruh aktivitas pengguna non-admin saat ini diblokir."
              : "Situs berjalan normal."}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={save} className="space-y-5">
        {/* Toggle enable */}
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)]/60 px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Aktifkan mode maintenance
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Saat ON, semua pengguna non-admin melihat layar maintenance &
              semua panggilan API tertolak (503).
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
              enabled ? "bg-amber-500" : "bg-[var(--muted)]",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </label>

        {/* Pesan kustom */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Judul
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder={DEFAULT_TITLE}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-canton"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Pesan
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            rows={4}
            placeholder={DEFAULT_MESSAGE}
            className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-canton"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Estimasi selesai{" "}
            <span className="font-normal text-[var(--muted-foreground)]">
              (opsional)
            </span>
          </label>
          <input
            type="datetime-local"
            value={estimatedEnd}
            onChange={(e) => setEstimatedEnd(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-canton"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60",
              enabled ? "bg-amber-500 hover:opacity-90" : "bg-emerald-600 hover:opacity-90",
            )}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : enabled ? (
              <Power className="h-4 w-4" />
            ) : (
              <PowerOff className="h-4 w-4" />
            )}
            {enabled ? "Aktifkan maintenance" : "Nonaktifkan & simpan"}
          </button>
          <button
            type="button"
            onClick={refresh}
            className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Muat ulang
          </button>
        </div>
      </form>
    </div>
  );
}

/** Konversi ISO string → value untuk <input type="datetime-local"> (YYYY-MM-DDTHH:mm, lokal). */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
