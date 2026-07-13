"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatApiError } from "@/lib/api/format-api-error";
import { Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { TokenLogo, displayName } from "@/components/app/wallet/token-logo";

type PreapprovalStatus = {
  active?: boolean;
  expiresAt?: string | null;
  message?: string;
};

// Token list untuk preapproval toggle. CC selalu fungsional. Non-CC tampil
// sebagai "Coming soon" kecuali di-enable via env PREAPPROVAL_ENABLED_TOKENS.
const ALL_TOKENS = ["CC", "USDCx", "CBTC"] as const;
type TokenSymbol = (typeof ALL_TOKENS)[number];

export function SettingsPreapprovalPanel() {
  // CC status (dari preapproval endpoint existing).
  const [ccActive, setCcActive] = useState(false);
  const [ccExpiresAt, setCcExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Token mana yang toggle-nya ENABLED (fungsional). CC selalu ada.
  // Di-fetch dari /api/party/fee-config → preapprovalTokens.
  const [enabledTokens, setEnabledTokens] = useState<string[]>(["CC"]);

  const loadCcStatus = useCallback(async () => {
    setLoading(true);
    try {
      let res = await fetch("/api/party/preapproval", {
        credentials: "include",
      });
      if (!res.ok) {
        res = await fetch("/api/party/preapproval-status", {
          credentials: "include",
        });
      }
      if (res.ok) {
        const data = (await res.json()) as PreapprovalStatus & {
          preapproval?: { active?: boolean; expiresAt?: string | null };
        };
        const isActive =
          data.active === true || data.preapproval?.active === true;
        setCcActive(isActive);
        setCcExpiresAt(
          data.expiresAt ?? data.preapproval?.expiresAt ?? null,
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/party/fee-config", {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          preapprovalTokens?: string[];
        };
        if (data.preapprovalTokens) {
          setEnabledTokens(
            data.preapprovalTokens.map((t) => t.toUpperCase()),
          );
        }
      }
    } catch {
      /* non-fatal — default CC only */
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadCcStatus(), loadConfig()]);
  }, [loadCcStatus, loadConfig]);

  async function toggleCc() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const action = ccActive ? "disable" : "enable";
    try {
      let res = await fetch(`/api/party/preapproval/${action}`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 404 && !ccActive) {
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
        await loadCcStatus();
        return;
      }
      setSuccess(
        action === "disable"
          ? "CC one-step transfer disabled."
          : "CC one-step transfer enabled.",
      );
      await loadCcStatus();
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
            Auto-accept incoming transfers without manual approval
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6 md:p-8 space-y-4">
        {loading ? (
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <LoadingSpinner size="sm" tone="muted" />
            Checking status…
          </div>
        ) : (
          ALL_TOKENS.map((token) => {
            const isEnabled = enabledTokens.includes(token.toUpperCase());
            const isActive = token === "CC" ? ccActive : false;
            const isBusy = token === "CC" ? busy : false;

            return (
              <TokenToggleRow
                key={token}
                token={token}
                enabled={isEnabled}
                active={isActive}
                busy={isBusy}
                expiresAt={token === "CC" ? ccExpiresAt : null}
                onToggle={token === "CC" ? () => void toggleCc() : undefined}
              />
            );
          })
        )}

        {/* Error */}
        {error ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-300">
            {error}
          </p>
        ) : null}

        {/* Success */}
        {success ? (
          <p className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {success}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Map toggle token symbol → internal instrument ID (for TokenLogo + displayName). */
const TOKEN_INSTRUMENT_ID: Record<TokenSymbol, string> = {
  CC: "Amulet",
  USDCx: "USDCX",
  CBTC: "CBTC",
};

/** Row untuk satu token toggle. */
function TokenToggleRow({
  token,
  enabled,
  active,
  busy,
  expiresAt,
  onToggle,
}: {
  token: TokenSymbol;
  enabled: boolean;
  active: boolean;
  busy: boolean;
  expiresAt: string | null;
  onToggle?: () => void;
}) {
  const instrumentId = TOKEN_INSTRUMENT_ID[token];
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.04] bg-white/[0.01] px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <TokenLogo symbol={instrumentId} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                "text-sm font-semibold",
                enabled
                  ? active
                    ? "text-emerald-300/80"
                    : "text-slate-200"
                  : "text-slate-500",
              )}
            >
              {displayName(instrumentId)}
            </p>
            {!enabled && (
              <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                Coming soon
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {enabled
              ? active
                ? `Incoming ${token} arrives directly`
                : `Incoming ${token} requires manual accept`
              : `${token} auto-accept — not yet available`}
          </p>
          {enabled && active && expiresAt && (
            <p className="mt-1 text-xs text-slate-600">
              Expires {new Date(expiresAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Toggle switch */}
      {enabled ? (
        <button
          type="button"
          disabled={busy}
          onClick={onToggle}
          role="switch"
          aria-checked={active}
          aria-label={`Toggle one step transfer ${token}`}
          className="relative shrink-0"
        >
          {busy ? (
            <div className="flex h-7 w-12 items-center justify-center rounded-full bg-slate-700">
              <LoadingSpinner size="sm" />
            </div>
          ) : (
            <div
              className={cn(
                "h-7 w-12 rounded-full transition-colors duration-200",
                active ? "bg-emerald-600" : "bg-slate-700",
              )}
            >
              <div
                className={cn(
                  "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200",
                  active ? "translate-x-[22px]" : "translate-x-0.5",
                )}
              />
            </div>
          )}
        </button>
      ) : (
        // Disabled placeholder — lock icon, tidak bisa diklik.
        <div className="flex h-7 w-12 items-center justify-center rounded-full bg-slate-800/50">
          <Lock className="h-3.5 w-3.5 text-slate-600" />
        </div>
      )}
    </div>
  );
}
