"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/utils";

/**
 * Shape of GET /api/quests/:questId/eligibility (mirrors backend getQuestEligibility).
 */
interface EligibilityResponse {
  eligible: boolean;
  mode: "CC_OR_POINTS" | "CC_ONLY" | "POINTS_ONLY" | "NONE";
  ccLockAmount: number;
  entryCostPoints: number;
  lockedCc: number;
  netPoints: number;
  hasEntry: boolean;
  reason: string;
}

/**
 * Eligibility badge for an Earn campaign.
 *
 * Fetches GET /api/quests/:questId/eligibility (auth, via BFF cookie proxy) and shows:
 *   - green  "✓ Eligible"   when the user meets the gate requirement
 *   - red    "✗ Not eligible" with a reason when they don't
 *
 * Rendered only for logged-in users. NONE-gate / EARN_HUB quests are always eligible,
 * so the badge stays green. The underlying reason text comes from the API.
 */
export function CampaignEligibilityBadge({ questId }: { questId: string }) {
  const [data, setData] = useState<EligibilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/quests/${questId}/eligibility`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error("eligibility fetch failed");
        return r.json() as Promise<EligibilityResponse>;
      })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [questId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--muted-foreground)]" aria-hidden />
        <span className="text-xs font-medium text-[var(--muted-foreground)]">
          Checking eligibility…
        </span>
      </div>
    );
  }

  // Network/API failure: don't block the user — show a neutral state.
  if (error || !data) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3">
        <span className="text-xs leading-relaxed text-[var(--muted-foreground)]">
          Could not verify eligibility right now. The access check will run again when
          you submit your first task.
        </span>
      </div>
    );
  }

  const eligible = data.eligible;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3",
        eligible
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-red-500/20 bg-red-500/5",
      )}
    >
      {eligible ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
      )}
      <div className="flex-1">
        <p
          className={cn(
            "text-xs font-bold uppercase tracking-wider",
            eligible ? "text-emerald-400" : "text-red-400",
          )}
        >
          {eligible ? "Eligible" : "Not eligible"}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">{data.reason}</p>
      </div>
    </div>
  );
}
