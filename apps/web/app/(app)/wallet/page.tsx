"use client";

import { useCallback, useEffect, useState } from "react";
import { WalletSetup } from "@/components/app/wallet-setup";
import { WalletDashboard } from "@/components/app/wallet-dashboard";
import { AlertTriangle, Loader2 } from "lucide-react";

type Me = {
  username?: string | null;
  cantonPartyId?: string | null;
};

interface LedgerStatus {
  canton: { reachable: boolean };
  splice: { reachable: boolean; configured: boolean };
  message: string;
}

export default function WalletPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatus | null>(null);

  const refresh = useCallback(async () => {
    const [meRes, statusRes] = await Promise.allSettled([
      fetch("/api/me", { credentials: "include", cache: "no-store" }),
      fetch("/api/party/ledger-status", { credentials: "include" }),
    ]);

    if (meRes.status === "fulfilled" && meRes.value.ok) {
      setMe((await meRes.value.json()) as Me);
    }
    if (statusRes.status === "fulfilled" && statusRes.value.ok) {
      setLedgerStatus((await statusRes.value.json()) as LedgerStatus);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  const hasRealParty =
    Boolean(me?.cantonPartyId) && !me?.cantonPartyId?.startsWith("canquest:user:");

  const showNodeWarning =
    ledgerStatus && (!ledgerStatus.canton.reachable || !ledgerStatus.splice.reachable);

  return (
    <div className="space-y-4">
      {/* Node connectivity warning */}
      {showNodeWarning && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300">Node connection issue</p>
            <p className="mt-0.5 text-amber-700 dark:text-amber-400">{ledgerStatus.message}</p>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
              Canton JSON API: {ledgerStatus.canton.reachable ? "✓ OK" : "✗ Offline"}
              {" · "}
              Splice Validator: {ledgerStatus.splice.reachable ? "✓ OK" : "✗ Offline"}
            </p>
          </div>
        </div>
      )}

      {!me?.username || !hasRealParty ? (
        <WalletSetup onCreated={refresh} />
      ) : (
        <WalletDashboard me={me} onRefresh={refresh} />
      )}
    </div>
  );
}
