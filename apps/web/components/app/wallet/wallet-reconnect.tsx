"use client";

import { formatUsernameForDisplay } from "@/lib/canton/canton-party-id";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/api/format-api-error";
import { allocateParty } from "@/lib/services/api/party";
import { RefreshCw, Wallet } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

type WalletReconnectProps = {
  username: string;
  onConnected: () => void;
};

/**
 * User has a username but only a placeholder party (node was down at create time).
 */
export function WalletReconnect({ username, onConnected }: WalletReconnectProps) {
  const t = usePlatformT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReconnect() {
    setBusy(true);
    setError(null);
    try {
      await allocateParty();
      onConnected();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
      <div className="w-full min-w-0 max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/5">
            <Wallet className="h-10 w-10 text-orange-400" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-slate-100">{t("wallet.reconnectTitle")}</h2>
        <p className="mt-3 text-sm font-medium text-slate-400">
          {t("wallet.reconnectHint")}
        </p>
        <p className="mt-5 font-mono text-base font-semibold text-slate-100">
          @{formatUsernameForDisplay(username)}
        </p>

        {error ? (
          <p
            className="mt-6 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleReconnect()}
          className={cn(buttonVariants({ size: "lg" }), "mt-10 w-full gap-2")}
        >
          {busy ? (
            <>
              <LoadingSpinner size="md" />
              {t("wallet.reconnecting")}
            </>
          ) : (
            <>
              <RefreshCw className="h-5 w-5" />
              {t("wallet.reconnectBtn")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
