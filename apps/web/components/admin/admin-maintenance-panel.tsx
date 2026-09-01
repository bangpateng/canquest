"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/services/api/client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ShieldAlert, Power, PowerOff } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";

interface MaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  estimatedEnd: string | null;
}

const DEFAULT_TITLE = "CanQuest is under maintenance";
const DEFAULT_MESSAGE =
  "We're making updates to improve your experience. All activity is temporarily paused. Please check back soon.";

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
      const data = await apiFetch<MaintenanceStatus>("/api/admin/maintenance");
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
        "Turn on maintenance mode?\n\nALL non-admin users will be blocked immediately and see the maintenance screen. The admin panel stays accessible.",
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      await apiFetch("/api/admin/maintenance", {
        method: "PUT",
        json: {
          enabled,
          title: title.trim() || undefined,
          message: message.trim() || undefined,
          estimatedEnd: estimatedEnd
            ? new Date(estimatedEnd).toISOString()
            : null,
        },
      });
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
        <LoadingSpinner size="md" />
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
            status?.enabled ? "text-amber-600" : "text-emerald-600",
          )}
        />
        <div className="text-sm">
          <p className="font-semibold text-[var(--foreground)]">
            {status?.enabled
              ? "Maintenance mode is ON"
              : "Maintenance mode is OFF"}
          </p>
          <p className="text-[var(--muted-foreground)]">
            {status?.enabled
              ? "All non-admin user activity is currently blocked."
              : "The site is running normally."}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={save} className="space-y-5">
        {/* Toggle enable */}
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)]/60 px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Enable maintenance mode
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              When ON, every non-admin user sees the maintenance screen and all
              API calls are rejected (503).
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
              enabled ? "bg-[var(--primary)]" : "bg-[var(--muted)]",
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
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder={DEFAULT_TITLE}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]/50"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Message
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            rows={4}
            placeholder={DEFAULT_MESSAGE}
            className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]/50"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Estimated end{" "}
            <span className="font-normal text-[var(--muted-foreground)]">
              (optional)
            </span>
          </label>
          <input
            type="datetime-local"
            value={estimatedEnd}
            onChange={(e) => setEstimatedEnd(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]/50"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className={cn(
              buttonVariants({ variant: "primary", size: "sm" }),
              "transition-opacity disabled:opacity-60",
            )}
          >
            {saving ? (
              <LoadingSpinner size="md" />
            ) : enabled ? (
              <Power className="h-4 w-4" />
            ) : (
              <PowerOff className="h-4 w-4" />
            )}
            {enabled ? "Turn on & save" : "Turn off & save"}
          </button>
          <button
            type="button"
            onClick={refresh}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Reload
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
