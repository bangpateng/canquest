"use client";

import { Switch } from "@/components/ui/switch";
import { WALLET_TRANSFER_PREF_KEYS as KEYS } from "@/lib/wallet-transfer-prefs";
import { useEffect, useId, useState } from "react";

const HELP_UTXO =
  "UTXO-style balances when your stack supports them—typically less contention on busy accounts.";
const HELP_PREAPPROVAL =
  "Skips asking you to approve every CC transfer when your participant delegates safely within limits.";
const TIP_DUAL = "Both on: smoothest send/receive once the Participant API is connected (preview UI today).";
const PREVIEW_BOTH_ON =
  "Preview: connect Participant APIs and DAML flows before using real funds.";

type CantonTransferPreferencesProps = {
  /** One wallet card: two toggles + copy only (no long intro blocks). */
  variant?: "full" | "wallet-card";
};

export function CantonTransferPreferences({
  variant = "full",
}: CantonTransferPreferencesProps) {
  const [utxo, setUtxo] = useState(false);
  const [preapproval, setPreapproval] = useState(false);
  const [ready, setReady] = useState(false);
  const utxoLbl = useId();
  const papLbl = useId();

  useEffect(() => {
    try {
      setUtxo(localStorage.getItem(KEYS.utxo) === "1");
      setPreapproval(localStorage.getItem(KEYS.preapproval) === "1");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEYS.utxo, utxo ? "1" : "0");
      localStorage.setItem(KEYS.preapproval, preapproval ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [utxo, preapproval, ready]);

  const bothOn = utxo && preapproval;

  const footer = bothOn ? (
    <div className="rounded-xl border border-canton-muted bg-canton-subtle px-4 py-3 text-sm text-canton">
      {PREVIEW_BOTH_ON}
    </div>
  ) : (
    <p className="text-xs text-[var(--muted-foreground)]">{TIP_DUAL}</p>
  );

  if (variant === "wallet-card") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          UTXO &amp; preapproval
        </p>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1 pr-2">
            <p id={utxoLbl} className="font-[family-name:var(--font-space)] text-sm font-semibold">
              Enable UTXO-style accounting
            </p>
            <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{HELP_UTXO}</p>
          </div>
          <Switch
            checked={utxo}
            onCheckedChange={setUtxo}
            aria-labelledby={utxoLbl}
            disabled={!ready}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t border-[var(--border)] pt-4">
          <div className="min-w-0 flex-1 space-y-1 pr-2">
            <p id={papLbl} className="font-[family-name:var(--font-space)] text-sm font-semibold">
              Enable preapproval (no manual approve per CC move)
            </p>
            <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{HELP_PREAPPROVAL}</p>
          </div>
          <Switch
            checked={preapproval}
            onCheckedChange={setPreapproval}
            aria-labelledby={papLbl}
            disabled={!ready}
          />
        </div>

        <div className="mt-4">{footer}</div>
        {!ready ? (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">Loading preferences…</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
        On Canton, smoother CC movement uses{" "}
        <strong className="font-medium text-[var(--foreground)]">UTXO-aware settlement</strong> and{" "}
        <strong className="font-medium text-[var(--foreground)]">pre-approved transfer rights</strong>{" "}
        so payouts and treasury routes do not require a manual ledger approval on every hop. Exactly
        which choices and templates apply must follow your participant node and Digital Asset Ledger API
        setup — values here only drive this UI prototype.
      </p>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 p-4 text-xs text-[var(--muted-foreground)]">
        <p>
          Goal: outbound CC (wallet → external) and inbound CC (external → wallet) settle without an
          extra &quot;tap approve&quot; step in the web app whenever your party has delegated those
          rights safely.
        </p>
      </div>

      <ul className="space-y-4">
        <li className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-4">
          <div className="min-w-0 max-w-xl space-y-1">
            <p id={utxoLbl} className="font-[family-name:var(--font-space)] text-sm font-semibold">
              Enable UTXO-style accounting
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">{HELP_UTXO}</p>
          </div>
          <Switch
            checked={utxo}
            onCheckedChange={setUtxo}
            aria-labelledby={utxoLbl}
            disabled={!ready}
          />
        </li>
        <li className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-4">
          <div className="min-w-0 max-w-xl space-y-1">
            <p id={papLbl} className="font-[family-name:var(--font-space)] text-sm font-semibold">
              Enable preapproval (no manual approve per CC move)
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">{HELP_PREAPPROVAL}</p>
          </div>
          <Switch
            checked={preapproval}
            onCheckedChange={setPreapproval}
            aria-labelledby={papLbl}
            disabled={!ready}
          />
        </li>
      </ul>

      {footer}

      {!ready ? (
        <p className="text-xs text-[var(--muted-foreground)]">Loading preferences…</p>
      ) : null}
    </div>
  );
}
