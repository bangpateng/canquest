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
      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden />
        <span className="text-xs font-medium text-slate-400">
          Checking eligibility…
        </span>
      </div>
    );
  }

  // Network/API failure: don't block the user — show a neutral state.
  if (error || !data) {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <span className="flex-1 text-xs leading-relaxed text-slate-400">
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
        "flex items-start gap-2.5 rounded-2xl border px-4 py-3",
        eligible
          ? "border-emerald-500/25 bg-emerald-500/[0.06]"
          : "border-red-500/25 bg-red-500/[0.06]",
      )}
    >
      {eligible ? (
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
          aria-hidden
        />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
      )}
      <div className="flex-1">
        <p
          className={cn(
            "text-xs font-bold uppercase tracking-wider",
            eligible ? "text-emerald-300" : "text-red-300",
          )}
        >
          {eligible ? "Eligible" : "Not eligible"}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{data.reason}</p>
      </div>
    </div>
  );
}
