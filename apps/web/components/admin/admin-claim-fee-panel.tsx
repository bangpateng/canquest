"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/services/api/client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Info, RotateCcw, Wallet } from "lucide-react";
import { cn } from "@/lib/utils/utils";

interface ClaimFeeStatus {
  tokenFeeCc: number;
  codeFeeCc: number;
  combinedFeeCc: number;
  configured: Record<string, boolean>;
}

const DEFAULTS = { tokenFeeCc: 3, codeFeeCc: 2, combinedFeeCc: 3 };

/** Kelompok fee → reward type yang kena (buat label panel). */
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
    label: "Kode waitlist (FCFS / Raffle)",
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
  "Gagal memuat setting claim fee. Coba refresh — kalau tetap, kabari backend.";

export function AdminClaimFeePanel() {
  const [status, setStatus] = useState<ClaimFeeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Draft per group: "" = (belum diubah) pakai nilai efektif.
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
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Fee ${g.label} harus angka lebih dari 0.`);
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
        setSaved("Tidak ada perubahan.");
        return;
      }
      const affected = GROUPS.filter(
        (g) => status && payload[g.key] !== status[g.key as keyof ClaimFeeStatus],
      );
      const note = affected.length
        ? `\n\nFee default baru hanya berlaku untuk campaign BARU. Campaign lama yang masih pakai default otomatis dibekukan ke fee lamanya, jadi klaim mereka tetap jalan.`
        : "";
      const ok = window.confirm(
        `Terapkan fee default baru?\n${GROUPS.filter(
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
          ? `Tersimpan. ${res.frozenQuests} campaign lama dibekukan ke fee lamanya (klaim mereka aman).`
          : "Tersimpan. Berlaku untuk campaign yang dibuat mulai sekarang.",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan.");
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
        <span>Memuat setting fee…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Ringkasan */}
      <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-canton" />
        <div className="text-sm text-[var(--muted-foreground)]">
          <p className="font-semibold text-[var(--foreground)]">
            Fee default dipakai saat admin tidak mengisi “Claim fee” saat bikin
            campaign.
          </p>
          <p className="mt-1">
            Biaya dikenakan on-chain saat pemenang klaim reward. Fee campaign
            lama yang sudah jalan tidak akan berubah — Admin bisa tetap override
            per-campaign di form “Advanced — claim fee”.
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

      {/* Form per kelompok */}
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
                  {isCustom ? "Diatur manual" : "Default bawaan"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min="0.01"
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
                  title={`Kosongkan → kembali ke default ${g.fallback} CC`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Default {g.fallback}
                </button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Biarkan kosong / tekan “Default” untuk pakai nilai bawaan (
                {g.fallback} CC). Kosong tidak sama dengan 0 — 0 CC ditolak
                kontrak on-chain.
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
          {saving ? "Menyimpan…" : "Simpan fee default"}
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={saving}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Muat ulang
        </button>
      </div>
    </div>
  );
}
