"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/services/api/client";
import { CLAIM_FEE_MIN_CC } from "@/lib/quest/quest-engine";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Info, RotateCcw, Wallet } from "lucide-react";
import { cn } from "@/lib/utils/utils";

interface ClaimFeeStatus {
  tokenFeeCc: number;
  codeFeeCc: number;
  combinedFeeCc: number;
  configured: Record<string, boolean>;
}

const DEFAULTS = { tokenFeeCc: 1, codeFeeCc: 0.5, combinedFeeCc: 1 };

/** Fee group → the reward types it applies to (for the panel label). */
const GROUPS: {
  key: keyof typeof DEFAULTS;
  label: string;
  types: string;
  fallback: number;
}[] = [
  {
    key: "tokenFeeCc",
    label: "Token FCFS / Token Raffle",
    types: "CC_ONLY, CC_MANUAL",
    fallback: DEFAULTS.tokenFeeCc,
  },
  {
    key: "codeFeeCc",
    label: "Waitlist code (FCFS / Raffle)",
    types: "INVITE_CODE_FCFS, INVITE_CODE_RANDOM, …",
    fallback: DEFAULTS.codeFeeCc,
  },
  {
    key: "combinedFeeCc",
    label: "Token + Code Raffle",
    types: "CC_AND_CODE_RAFFLE",
    fallback: DEFAULTS.combinedFeeCc,
  },
];

const FEE_ERROR =
  "Failed to load claim fee settings. Try refreshing — if it persists, let the backend team know.";

export function AdminClaimFeePanel() {
  const [status, setStatus] = useState<ClaimFeeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Draft per group: "" = (not yet changed) use the effective value.
  const [draft, setDraft] = useState<Record<string, string>>({});

  async function refresh() {
    try {
      const data = await apiFetch<ClaimFeeStatus>("/api/admin/claim-fee");
      setStatus(data);
      setDraft({
        tokenFeeCc: String(data.tokenFeeCc),
        codeFeeCc: String(data.codeFeeCc),
        combinedFeeCc: String(data.combinedFeeCc),
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : FEE_ERROR);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    setError(null);
    setSaved(null);
    const parseGroup = (g: (typeof GROUPS)[number]) => {
      const raw = (draft[g.key] ?? "").trim();
      if (!raw) return null; // reset ke default
      const n = Number(raw);
      if (!Number.isFinite(n) || n < CLAIM_FEE_MIN_CC) {
        throw new Error(
          `Fee for ${g.label} must be at least ${CLAIM_FEE_MIN_CC} CC.`,
        );
      }
      return n;
    };
    try {
      const payload = Object.fromEntries(
        GROUPS.map((g) => [g.key, parseGroup(g)]),
      );
      const hasChange = GROUPS.some(
        (g) =>
          payload[g.key] === null ||
          payload[g.key] !== Number((draft[g.key] ?? "").trim()),
      );
      if (!hasChange) {
        setSaved("No changes to save.");
        return;
      }
      const affected = GROUPS.filter(
        (g) => status && payload[g.key] !== status[g.key as keyof ClaimFeeStatus],
      );
      const note = affected.length
        ? `\n\nNew default fees apply only to NEW campaigns. Older campaigns still on the default are automatically frozen at their current fee, so their claims keep working.`
        : "";
      const ok = window.confirm(
        `Apply new default fees?\n${GROUPS.filter(
          (g) => payload[g.key] !== Number((draft[g.key] ?? "").trim()),
        )
          .map((g) => `· ${g.label}: ${payload[g.key] ?? `${g.fallback} (default)`} CC`)
          .join("\n")}${note}`,
      );
      if (!ok) return;

      setSaving(true);
      const res = await apiFetch<{
        settings: ClaimFeeStatus;
        frozenQuests: number;
      }>("/api/admin/claim-fee", { method: "PUT", json: payload });
      setSaved(
        res.frozenQuests > 0
          ? `Saved. ${res.frozenQuests} older campaigns were frozen at their current fee (their claims are safe).`
          : "Saved. Applies to campaigns created from now on.",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  function resetGroup(key: string) {
    setDraft((d) => ({ ...d, [key]: "" }));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <LoadingSpinner size="md" />
        <span>Loading fee settings…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-canton" />
        <div className="text-sm text-[var(--muted-foreground)]">
          <p className="font-semibold text-[var(--foreground)]">
            Default fees apply when an admin leaves “Claim fee” empty when
            creating a campaign.
          </p>
          <p className="mt-1">
            Fees are charged on-chain when a winner claims a reward. Fees on
            campaigns already running will not change — admins can still
            override per campaign in the “Advanced — claim fee” form.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {saved}
        </div>
      )}

      {/* Form per group */}
      <div className="space-y-4">
        {GROUPS.map((g) => {
          const isCustom = status?.configured[g.key] ?? false;
          return (
            <div
              key={g.key}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {g.label}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    Reward type: {g.types}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium",
                    isCustom
                      ? "border-canton-muted bg-canton-soft text-canton"
                      : "border-[var(--border)] bg-[var(--muted)]/30 text-[var(--muted-foreground)]",
                  )}
                >
                  {isCustom ? "Set manually" : "Built-in default"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={CLAIM_FEE_MIN_CC}
                  step="any"
                  value={draft[g.key] ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [g.key]: e.target.value }))
                  }
                  placeholder={`${g.fallback} (default)`}
                  className="h-10 w-40 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
                />
                <span className="text-sm text-[var(--muted-foreground)]">CC</span>
                <button
                  type="button"
                  onClick={() => resetGroup(g.key)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  title={`Clear → revert to default (${g.fallback} CC)`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Default {g.fallback}
                </button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Leave empty / press “Default” to use the built-in value (
                {g.fallback} CC). Minimum fee {CLAIM_FEE_MIN_CC} CC.
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className={cn(
            "inline-flex h-10 items-center justify-center rounded-lg bg-canton px-5 text-sm font-semibold text-white transition-opacity",
            saving ? "opacity-60" : "hover:opacity-90",
          )}
        >
          {saving ? "Saving…" : "Save default fees"}
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={saving}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
