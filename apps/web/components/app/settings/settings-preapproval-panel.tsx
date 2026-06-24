"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatApiError } from "@/lib/api/format-api-error";
import { Zap, ZapOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type PreapprovalStatus = {
  active?: boolean;
  expiresAt?: string | null;
  message?: string;
};

export function SettingsPreapprovalPanel() {
  const [active, setActive] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let res = await fetch("/api/party/preapproval", { credentials: "include" });
      if (!res.ok) {
        res = await fetch("/api/party/preapproval-status", { credentials: "include" });
      }
      if (res.ok) {
        const data = (await res.json()) as PreapprovalStatus & {
          preapproval?: { active?: boolean; expiresAt?: string | null };
        };
        const isActive =
          data.active === true || data.preapproval?.active === true;
        setActive(isActive);
        setExpiresAt(data.expiresAt ?? data.preapproval?.expiresAt ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const action = active ? "disable" : "enable";
    try {
      let res = await fetch(`/api/party/preapproval/${action}`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 404 && !active) {
        res = await fetch("/api/party/ensure-preapproval", {
          method: "POST",
          credentials: "include",
        });
      }
      const raw = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!res.ok) {
        setError(formatApiError(raw));
        // Re-fetch authoritative status — the on-chain toggle may not have
        // taken effect, so do not trust the optimistic state.
        await load();
        return;
      }
      setSuccess(
        action === "disable"
          ? "One step transfer disabled — incoming CC will appear as offers."
          : "One step transfer enabled — incoming CC arrives directly.",
      );
      // Load authoritative on-chain status rather than flipping optimistically.
      // The backend re-verifies the cancel succeeded; load() reflects that.
      await load();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="preapproval"
      className="scroll-mt-8 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50"
    >
      {/* Section Header */}
      <div className="border-b border-white/[0.06] bg-white/[0.01] px-5 py-4 sm:px-6 sm:py-5 md:px-8">
        <div>
          <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            One Step Transfer
          </span>
          <p className="mt-1 text-xs text-slate-500">
            Auto-accept incoming CC without manual approval
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6 md:p-8">
        {loading ? (
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <LoadingSpinner size="sm" tone="muted" />
            Checking status…
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <p
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    active ? "text-emerald-300/80" : "text-slate-500"
                  }`}
                >
                  {active ? "Enabled" : "Disabled"}
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-300">
                  {active
                    ? "Incoming CC arrives directly in your wallet"
                    : "Incoming CC requires manual accept from offers"}
                </p>
              </div>
            </div>

            {/* Toggle switch */}
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggle()}
              role="switch"
              aria-checked={active}
              aria-label="Toggle one step transfer"
              className="relative shrink-0"
            >
              {busy ? (
                <div className="flex h-7 w-12 items-center justify-center rounded-full bg-slate-700">
                  <LoadingSpinner size="sm" />
                </div>
              ) : (
                <div
                  className={`h-7 w-12 rounded-full transition-colors duration-200 ${
                    active ? "bg-emerald-600" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      active ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </div>
              )}
            </button>
          </div>
        )}

        {/* Expiry info */}
        {active && expiresAt && !loading && (
          <p className="mt-4 text-xs text-slate-600">
            Expires: {new Date(expiresAt).toLocaleDateString()} · Auto-renewed
            by validator
          </p>
        )}

        {/* Error */}
        {error ? (
          <p className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-300 sm:mt-6 sm:px-5 sm:py-4">
            {error}
          </p>
        ) : null}

        {/* Success */}
        {success ? (
          <p className="mt-4 text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {success}
          </p>
        ) : null}
      </div>
    </section>
  );
}
