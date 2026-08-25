"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatApiError } from "@/lib/api/format-api-error";
import { Lock, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { Card } from "@/components/ui/card";
import { TokenLogo, displayName } from "@/components/app/wallet/token-logo";
import { useFeeConfig } from "@/lib/hooks/use-fee-config";
import { useMe } from "@/lib/hooks/use-me";
import {
  isAutoAcceptEnabled,
  setAutoAccept,
} from "@/lib/wallet/auto-accept";
import {
  getWalletKeyMeta,
  unlock,
  signBytes,
} from "@/lib/wallet/key-manager";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";

/**
 * Sign raw bytes and return hex-encoded signature.
 * Handles wallet unlock if locked (prompts passphrase).
 */
async function signHashRaw(
  bytes: Uint8Array,
  promptPassphrase: (desc: string) => Promise<string>,
): Promise<string> {
  try {
    const sigB64 = await signBytes(bytes);
    // Convert base64 to hex
    const raw = atob(sigB64);
    return Array.from(raw).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Wallet locked")) {
      const pass = await promptPassphrase("Enable instant receive");
      if (!pass) throw err;
      await unlock(pass);
      const sigB64 = await signBytes(bytes);
      const raw = atob(sigB64);
      return Array.from(raw).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    }
    throw err;
  }
}

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
  // Dari shared hook useFeeConfig (GET /api/party/fee-config → preapprovalTokens).
  // Ter-dedup dengan WalletActions yang baca endpoint sama.
  const { data: feeConfig } = useFeeConfig();
  const enabledTokens = feeConfig?.preapprovalTokens ?? ["CC"];
  const [collapsed, setCollapsed] = useState(false);
  // M3c: preapproval TIDAK MUNGKIN untuk wallet external (Daml butuh
  // co-authorizer provider — terbukti spike M3c). Sembunyikan toggle utk
  // user external; incoming transfer via offer + sign-accept (by design).
  const { me } = useMe();
  const isExternalWallet = me?.walletKind === "external";

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

  useEffect(() => {
    void loadCcStatus();
  }, [loadCcStatus]);

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

  if (isExternalWallet) {
    return (
      <Card
        id="preapproval"
        className="scroll-mt-8 overflow-hidden"
      >
        <div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center justify-between p-6 transition-colors hover:bg-[var(--primary)]/[0.04] sm:p-7"
          >
            <div className="text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                One Step Transfer
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Auto-accept incoming transfers without manual approval
              </p>
            </div>
            <ChevronDown
              className={cn(
                "h-5 w-5 shrink-0 text-canton transition-transform duration-200",
                collapsed ? "" : "rotate-180",
              )}
            />
          </button>

          <div
            className={cn(
              "space-y-3 px-6 pb-6 sm:space-y-4 sm:px-7 sm:pb-7",
              collapsed && "hidden",
            )}
          >
            {/* CC — Preapproval toggle (M5b: works for external via validator API) */}
            <ExternalPreapprovalRow />

            {/* Other tokens — same "Coming soon" as custodial */}
            {ALL_TOKENS.filter((t) => t !== "CC").map((token) => (
              <TokenToggleRow
                key={token}
                token={token}
                enabled={false}
                active={false}
                busy={false}
                expiresAt={null}
                onToggle={undefined}
              />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      id="preapproval"
      className="scroll-mt-8 overflow-hidden"
    >
      <div>
        {/* Section header — clickable to collapse/expand */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center justify-between p-6 transition-colors hover:bg-[var(--primary)]/[0.04] sm:p-7"
        >
          <div className="text-left">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              One Step Transfer
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Auto-accept incoming transfers without manual approval
            </p>
          </div>
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-canton transition-transform duration-200",
              collapsed ? "" : "rotate-180",
            )}
          />
        </button>

        <div
          className={cn(
            "space-y-3 px-6 pb-6 sm:space-y-4 sm:px-7 sm:pb-7",
            collapsed && "hidden",
          )}
        >
        {loading ? (
          <div className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
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
          <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-600">
            {error}
          </p>
        ) : null}

        {/* Success */}
        {success ? (
          <p className="text-sm font-semibold text-emerald-600 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {success}
          </p>
        ) : null}
        </div>
      </div>
    </Card>
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
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3.5 transition-colors hover:border-[var(--primary)]/25 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <TokenLogo symbol={instrumentId} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                "text-sm font-semibold",
                enabled
                  ? active
                    ? "text-canton"
                    : "text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)]",
              )}
            >
              {displayName(instrumentId)}
            </p>
            {!enabled && (
              <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                Coming soon
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            {enabled
              ? active
                ? `Incoming ${token} arrives directly`
                : `Incoming ${token} requires manual accept`
              : `${token} auto-accept — not yet available`}
          </p>
          {enabled && active && expiresAt && (
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
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
            <div className="flex h-7 w-12 items-center justify-center rounded-full bg-[var(--muted)]">
              <LoadingSpinner size="sm" />
            </div>
          ) : (
            <div
              className={cn(
                "h-7 w-12 rounded-full transition-colors duration-200",
                active ? "switch-brand-on" : "bg-[var(--muted)]",
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
        <div className="flex h-7 w-12 items-center justify-center rounded-full bg-[var(--muted)]/50">
          <Lock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        </div>
      )}
    </div>
  );
}

// ── External Preapproval Row (M5b: same visual as custodial TokenToggleRow) ──
function ExternalPreapprovalRow() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prompt: promptPassphrase } = usePassphrasePrompt();

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/party/preapproval-status", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setOn(Boolean(data.active));
        }
      } catch { /* non-fatal */ }
    })();
  }, []);

  async function handleToggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!on) {
        const meta = await getWalletKeyMeta();
        if (!meta?.publicKeyHex) throw new Error("No wallet key found");

        const prep = await fetch("/api/party/sign/preapproval/prepare", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKeyHex: meta.publicKeyHex }),
        });
        const prepRaw = await prep.json().catch(() => null);
        if (!prep.ok || !prepRaw?.hash) throw new Error(prepRaw?.message ?? "Prepare failed");

        const hashBytes = new Uint8Array(
          (String(prepRaw.hash).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
        );
        const sigHex = await signHashRaw(hashBytes, promptPassphrase);

        const exec = await fetch("/api/party/sign/preapproval/execute", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: sigHex }),
        });
        const execRaw = await exec.json().catch(() => null);
        if (!exec.ok) throw new Error(execRaw?.message ?? "Execute failed");
        setOn(true);
      } else {
        const res = await fetch("/api/party/sign/preapproval/disable", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          const raw = await res.json().catch(() => null);
          throw new Error(raw?.message ?? "Disable failed");
        }
        setOn(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3.5 transition-colors hover:border-[var(--primary)]/25 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <TokenLogo symbol="amulet" size="sm" />
        <div className="min-w-0">
          <p
            className={cn(
              "text-sm font-semibold",
              on ? "text-canton" : "text-[var(--foreground)]",
            )}
          >
            {displayName("amulet")}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            {on ? "Incoming CC arrives directly" : "Incoming CC requires manual accept"}
          </p>
          {error ? (
            <p className="mt-1 text-xs font-medium text-orange-600">{error}</p>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={() => void handleToggle()}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          on ? "bg-canton" : "bg-[var(--muted-foreground)]/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            on ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

// ── Auto-accept backup row (shown when preapproval is off) ──
function AutoAcceptBackupRow() {
  const [on, setOn] = useState(true);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setOn(isAutoAcceptEnabled());
    void fetch("/api/party/preapproval-status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setShow(!(data as { active?: boolean })?.active))
      .catch(() => setShow(true));
  }, []);

  if (!show) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-[var(--border)] px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--muted)]/60 text-xs">⚡</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--muted-foreground)]">Auto-Accept Backup</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            Auto-accept offers while wallet is unlocked
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => { const n = !on; setAutoAccept(n); setOn(n); }}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          on ? "bg-canton" : "bg-[var(--muted-foreground)]/30",
        )}
      >
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}

// ── Auto-accept switch (M5: replaces preapproval toggle for external users) ──
function AutoAcceptSwitch() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(isAutoAcceptEnabled()), []);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Auto-accept incoming transfers"
      onClick={() => {
        const next = !on;
        setAutoAccept(next);
        setOn(next);
      }}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        on ? "bg-canton" : "bg-[var(--muted-foreground)]/30",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
          on ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );
}

// ── Preapproval Toggle (M5b: ExternalPartySetupProposal via validator API) ──
function PreapprovalToggle() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prompt: promptPassphrase } = usePassphrasePrompt();
  const { me } = useMe();
  const isExternal = me?.walletKind === "external";

  useEffect(() => {
    if (!isExternal) return;
    void (async () => {
      try {
        const res = await fetch("/api/party/preapproval-status", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setOn(Boolean(data.active));
        }
      } catch { /* non-fatal */ }
    })();
  }, [isExternal]);

  async function handleToggle() {
    if (busy || !isExternal) return;
    setBusy(true);
    setError(null);
    try {
      if (!on) {
        const meta = await getWalletKeyMeta();
        if (!meta?.publicKeyHex) throw new Error("No wallet key found");

        const prep = await fetch("/api/party/sign/preapproval/prepare", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKeyHex: meta.publicKeyHex }),
        });
        const prepRaw = await prep.json().catch(() => null);
        if (!prep.ok || !prepRaw?.hash) throw new Error(prepRaw?.message ?? "Prepare failed");

        // Sign RAW hex-decoded bytes (NO 1220 prefix!)
        const hashBytes = new Uint8Array(
          (String(prepRaw.hash).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
        );
        const sigHex = await signHashRaw(hashBytes, promptPassphrase);

        const exec = await fetch("/api/party/sign/preapproval/execute", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: sigHex }),
        });
        const execRaw = await exec.json().catch(() => null);
        if (!exec.ok) throw new Error(execRaw?.message ?? "Execute failed");
        setOn(true);
      } else {
        const res = await fetch("/api/party/sign/preapproval/disable", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          const raw = await res.json().catch(() => null);
          throw new Error(raw?.message ?? "Disable failed");
        }
        setOn(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/40 p-4">
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-[var(--foreground)]">
          One Step Transfer
        </p>
        <p className="mt-1 leading-relaxed text-[var(--muted-foreground)]">
          Receive Canton Coin (CC) instantly — no manual acceptance needed.
          90 days, auto-renews. CC only; other tokens use offer/accept.
        </p>
        {error ? (
          <p className="mt-2 text-xs font-medium text-orange-600">{error}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={() => void handleToggle()}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          on ? "bg-canton" : "bg-[var(--muted-foreground)]/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            on ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}
