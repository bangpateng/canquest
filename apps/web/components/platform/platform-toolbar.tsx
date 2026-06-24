"use client";

import { TransactionNotifications } from "@/components/platform/transaction-notifications";

/**
 * Platform toolbar.
 *
 * Theme toggle (light/dark) and language selector were removed by request —
 * the app is dark-only. The ThemeProvider + i18n providers are kept (they back
 * styling and the `t()` translations used across the app) but no longer expose
 * a user-facing toggle. Only transaction notifications remain here.
 */
export function PlatformToolbar() {
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <TransactionNotifications />
    </div>
  );
}
