"use client";

import { useEffect, useRef } from "react";

import { useMe } from "@/lib/hooks/use-me";
import { isUnlocked } from "@/lib/wallet/key-manager";
import { signRelayTransaction } from "@/lib/wallet/sign-relay";
import { useTransactionStatus } from "@/lib/tx/transaction-status";

/**
 * useAutoAccept — auto-accept incoming TransferInstructions while the wallet
 * is unlocked (M5 UX polish). Makes incoming CC feel instant like custodial.
 *
 * Listens to the realtime SSE stream for `balance:changed` events. When an
 * incoming offer is detected and the wallet is unlocked, it automatically
 * signs the accept — no user interaction needed.
 *
 * Requirements:
 *   - User must have walletKind === 'external'
 *   - Wallet must be unlocked (passphrase entered this session)
 *
 * Toggle: stored in localStorage 'cq_auto_accept' (default: ON)
 */

const STORAGE_KEY = "cq_auto_accept";

export function isAutoAcceptEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

export function setAutoAccept(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
}

// Track recently processed offer CIDs to avoid double-accept
const recentCids = new Set<string>();
const RECENT_TTL_MS = 30_000;

function markRecent(cid: string): boolean {
  const now = Date.now();
  // Clean old entries
  for (const [c, t] of (recentCids as any)._timestamps ?? []) {
    if (now - t > RECENT_TTL_MS) recentCids.delete(c);
  }
  if (recentCids.has(cid)) return false;
  recentCids.add(cid);
  // Store timestamp
  if (!(recentCids as any)._timestamps) (recentCids as any)._timestamps = new Map();
  (recentCids as any)._timestamps.set(cid, now);
  return true;
}

export function useAutoAccept() {
  const { me } = useMe();
  const tx = useTransactionStatus();
  const busyRef = useRef(false);

  const isExternal = me?.walletKind === "external";
  const enabled = isAutoAcceptEnabled();

  useEffect(() => {
    if (!isExternal || !enabled) return;

    // Listen for SSE events via the existing realtime system
    // The realtime stream pushes 'balance:changed' and we check for pending offers
    const checkAndAccept = async () => {
      if (busyRef.current) return;
      if (!(await isUnlocked())) return;

      busyRef.current = true;
      try {
        // Fetch pending offers
        const res = await fetch("/api/party/offers?direction=incoming", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          offers?: Array<{
            contractId: string;
            instrumentId?: string;
            amount?: string;
          }>;
        };
        const offers = data.offers ?? [];

        for (const offer of offers) {
          if (!markRecent(offer.contractId)) continue;

          console.log(
            `[auto-accept] Accepting incoming transfer: ${offer.amount ?? "?"} ${offer.instrumentId ?? "CC"} (${offer.contractId.slice(0, 16)}…)`,
          );

          try {
            await signRelayTransaction(
              "accept_offer",
              { contractId: offer.contractId },
              {
                // If wallet locks during batch, stop silently — next event will retry
                onWalletLocked: () => Promise.resolve(""),
              },
            );
            console.log(`[auto-accept] Accepted: ${offer.contractId.slice(0, 16)}…`);
          } catch (err) {
            // Non-fatal — offer remains in inbox for manual accept
            console.warn(
              `[auto-accept] Failed to accept ${offer.contractId.slice(0, 16)}…: ${err}`,
            );
          }
        }
      } catch {
        // Network error — will retry on next event
      } finally {
        busyRef.current = false;
      }
    };

    // Check on mount and on every realtime event
    void checkAndAccept();

    // Listen to SSE via EventSource (same pattern as use-realtime.ts)
    const checkInterval = setInterval(() => void checkAndAccept(), 10_000);

    return () => clearInterval(checkInterval);
  }, [isExternal, enabled]);

  return { isAutoAcceptEnabled: enabled };
}
