"use client";

import { formatUsernameForDisplay } from "@/lib/canton-party-id";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/format-api-error";
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
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-orange-500/30 bg-orange-500/10">
            <Wallet className="h-8 w-8 text-orange-400" />
          </div>
        </div>
        <h2 className="type-page-title">{t("wallet.reconnectTitle")}</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {t("wallet.reconnectHint")}
        </p>
        <p className="mt-4 font-mono text-sm text-[var(--foreground)]">
          @{formatUsernameForDisplay(username)}
        </p>

        {error ? (
          <p
            className="mt-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleReconnect()}
          className={cn(buttonVariants({ size: "lg" }), "mt-8 w-full gap-2")}
        >
          {busy ? (
            <>
              <LoadingSpinner size="md" />
              {t("wallet.reconnecting")}
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              {t("wallet.reconnectBtn")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
