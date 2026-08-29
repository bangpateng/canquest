"use client";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/utils";
import { Card } from "@/components/ui/card";
import { TokenLogo, displayName } from "@/components/app/wallet/token-logo";
import { useMe } from "@/lib/hooks/use-me";
import { getWalletKeyMeta, unlock, signBytesHex, tryDeviceAutoUnlock } from "@/lib/wallet/key-manager";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";
import { signRelayTransaction } from "@/lib/wallet/sign-relay";

/**
 * Sign raw bytes and return hex-encoded signature.
 * Handles wallet unlock if locked (prompts passphrase).
 */
async function signHashRaw(
  bytes: Uint8Array,
  promptPassphrase: (desc: string) => Promise<string>,
): Promise<string> {
  try {
    return await signBytesHex(bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Wallet locked")) {
      // Passwordless: coba device auto-unlock dulu (mirror signHashWithUnlock).
      if (await tryDeviceAutoUnlock()) {
        return signBytesHex(bytes);
      }
      const pass = await promptPassphrase("Enable instant receive");
      if (!pass) throw err;
      await unlock(pass);
      return signBytesHex(bytes);
    }
    throw err;
  }
}

// Token list untuk baris "Coming soon". CC fungsional (ExternalPreapprovalRow).
const ALL_TOKENS = ["CC", "USDCx", "CBTC"] as const;
type TokenSymbol = (typeof ALL_TOKENS)[number];

export function SettingsPreapprovalPanel() {
  const [collapsed, setCollapsed] = useState(false);
  // Semua wallet CanQuest kini non-custodial (M5). Section ini hanya relevan
  // untuk user external; yang belum punya wallet tidak melihat apa-apa.
  const { me } = useMe();
  const isExternalWallet = me?.walletKind === "external";

  if (!isExternalWallet) return null;

  return (
    <Card id="preapproval" className="scroll-mt-8 overflow-hidden">
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
          {/* CC — Preapproval toggle (validator API, signed in browser) */}
          <ExternalPreapprovalRow />

          {/* USDCx — Preapproval toggle (token registry, relay sign flow) */}
          <RegistryPreapprovalRow />

          {/* Other tokens — "Coming soon" */}
          {ALL_TOKENS.filter((t) => t !== "CC" && t !== "USDCx").map((token) => (
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
              <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--muted-foreground)]" />
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
        <div className="flex h-7 w-12 items-center justify-center rounded-full bg-[var(--muted)]/50 text-[var(--muted-foreground)]">
          <span aria-hidden>🔒</span>
        </div>
      )}
    </div>
  );
}

// ── Registry (USDCx) Preapproval Row — sign-relay flow, passwordless ──
// Template Utility.Registry.App.V0.Model.TransferPreapproval: create/Archive
// cukup SATU signature user → sama seperti send/swap (modal Signature Request).
function RegistryPreapprovalRow() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/party/preapproval-status", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setOn(Boolean(data?.usdcx?.active));
        }
      } catch { /* non-fatal */ }
    })();
  }, []);

  async function handleToggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const flow = on ? "usdcx_preapproval_disable" : "usdcx_preapproval_enable";
      await signRelayTransaction(flow);
      setOn(!on);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
      // Auto-clear stale pending supaya user bisa retry langsung
      void fetch("/api/party/sign/cancel", { method: "POST", credentials: "include" }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3.5 transition-colors hover:border-[var(--primary)]/25 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <TokenLogo symbol="USDCX" size="sm" />
        <div className="min-w-0">
          <p
            className={cn(
              "text-sm font-semibold",
              on ? "text-canton" : "text-[var(--foreground)]",
            )}
          >
            {displayName("USDCX")}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            {on ? "Incoming USDCx arrives directly" : "Incoming USDCx requires manual accept"}
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
        aria-label="Toggle one step transfer USDCx"
        disabled={busy}
        onClick={() => void handleToggle()}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          on ? "bg-[rgb(var(--canton-rgb))]" : "bg-[var(--border)]",
        )}
      >
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--muted-foreground)]" />
          </span>
        ) : (
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
              on ? "left-[22px]" : "left-0.5",
            )}
          />
        )}
      </button>
    </div>
  );
}

// ── External Preapproval Row (validator API, browser-signed) ──
function ExternalPreapprovalRow() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();

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
      const meta = await getWalletKeyMeta();
      if (!on) {
        if (!meta?.publicKeyHex) throw new Error("No wallet key found");

        const prep = await fetch("/api/party/sign/preapproval/prepare", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKeyHex: meta.publicKeyHex }),
        });
        const prepRaw = await prep.json().catch(() => null);
        if (!prep.ok) throw new Error(prepRaw?.message ?? "Prepare failed");
        // Preapproval already active on-chain (idempotent re-enable) —
        // nothing to sign, just reflect the real state.
        if (prepRaw?.alreadyEnabled) {
          setOn(true);
          return;
        }
        if (!prepRaw?.hash) throw new Error(prepRaw?.message ?? "Prepare failed");

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
      // Auto-clear stale pending supaya user bisa retry langsung
      void fetch("/api/party/sign/cancel", { method: "POST", credentials: "include" }).catch(() => undefined);
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
          on ? "bg-[rgb(var(--canton-rgb))]" : "bg-[var(--border)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            on ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
      {passphraseModal}
    </div>
  );
}
