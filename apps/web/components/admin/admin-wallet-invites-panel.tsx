"use client";

import { buttonVariants } from "@/components/ui/button";
import { inputClass } from "@/lib/ui-tokens";
import { cn } from "@/lib/utils";
import { Copy, Plus, Trash2 } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCallback, useEffect, useState } from "react";

type WalletInviteRow = {
  id: string;
  code: string;
  note: string | null;
  createdAt: string;
  redeemedAt: string | null;
  reservedAt: string | null;
  reservedById: string | null;
  redeemedBy: { email: string; username: string | null } | null;
};

function rowStatus(row: WalletInviteRow): string {
  if (row.redeemedAt) return "Used";
  if (row.reservedById) return "In progress";
  return "Available";
}

type ListResponse = {
  total: number;
  available: number;
  used: number;
  codes: WalletInviteRow[];
};

export function AdminWalletInvitesPanel() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generateCount, setGenerateCount] = useState("10");
  const [note, setNote] = useState("");
  const [customCodes, setCustomCodes] = useState("");
  const [lastGenerated, setLastGenerated] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/wallet-invites", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ListResponse | { message?: string };
      if (!res.ok) {
        throw new Error(
          json && typeof json === "object" && "message" in json && typeof json.message === "string"
            ? json.message
            : "Failed to load wallet invite codes",
        );
      }
      setData(json as ListResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLastGenerated([]);
    try {
      const lines = customCodes
        .split(/[\n,]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      const body =
        lines.length > 0
          ? { codes: lines, note: note.trim() || undefined }
          : {
              count: Math.min(500, Math.max(1, parseInt(generateCount, 10) || 1)),
              note: note.trim() || undefined,
            };

      const res = await fetch("/api/admin/wallet-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as {
        codes?: string[];
        message?: string;
      };
      if (!res.ok) {
        throw new Error(json?.message ?? "Generate failed");
      }
      setLastGenerated(json.codes ?? []);
      setCustomCodes("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this unused wallet invite code?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/wallet-invites/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string };
        throw new Error(json?.message ?? "Delete failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">Total codes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data?.total ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">Available</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-canton">
            {data?.available ?? "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">Used</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data?.used ?? "—"}</p>
        </div>
      </div>

      <form
        onSubmit={handleGenerate}
        className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
      >
        <h2 className="type-subsection-title">Generate codes</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Each code is tied to one user when wallet creation succeeds. If creation fails or is
          incomplete, the same code can be used again.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">
              Auto-generate count
            </span>
            <input
              type="number"
              min={1}
              max={500}
              value={generateCount}
              onChange={(e) => setGenerateCount(e.target.value)}
              className={inputClass}
              disabled={busy || customCodes.trim().length > 0}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">
              Note (optional)
            </span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Batch March 2026"
              className={inputClass}
              disabled={busy}
            />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">
            Or paste custom codes (one per line)
          </span>
          <textarea
            value={customCodes}
            onChange={(e) => setCustomCodes(e.target.value)}
            rows={4}
            placeholder="WQ-ABC12345&#10;WQ-XYZ98765"
            className={cn(inputClass, "font-mono text-xs")}
            disabled={busy}
          />
        </label>

        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {lastGenerated.length > 0 ? (
          <div className="rounded-xl border border-canton/30 bg-canton/10 px-3 py-2 text-sm">
            <p className="font-semibold text-canton">Generated {lastGenerated.length} code(s)</p>
            <pre className="mt-2 max-h-32 overflow-auto font-mono text-xs text-[var(--foreground)]">
              {lastGenerated.join("\n")}
            </pre>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className={cn(buttonVariants(), "gap-2")}
        >
          {busy ? <LoadingSpinner size="sm" /> : <Plus className="h-4 w-4" />}
          Generate
        </button>
      </form>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-5 py-3">
          <h2 className="type-subsection-title">All codes</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted-foreground)]">
            <LoadingSpinner size="md" />
            Loading…
          </div>
        ) : !data?.codes.length ? (
          <p className="px-5 py-10 text-center text-sm text-[var(--muted-foreground)]">
            No wallet invite codes yet. Generate some above.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="sticky top-0 bg-[var(--card)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-4 py-2 font-semibold">Code</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Used by</th>
                  <th className="px-4 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.codes.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--muted)]/10">
                    <td className="px-4 py-2.5 font-mono text-xs">{row.code}</td>
                    <td className="px-4 py-2.5">
                      {rowStatus(row) === "Used" ? (
                        <span className="text-[var(--muted-foreground)]">Used</span>
                      ) : rowStatus(row) === "In progress" ? (
                        <span className="text-amber-300/90">In progress</span>
                      ) : (
                        <span className="font-medium text-canton">Available</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
                      {row.redeemedBy
                        ? row.redeemedBy.username
                          ? `@${row.redeemedBy.username}`
                          : row.redeemedBy.email
                        : row.note ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => void copyText(row.code)}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 w-8 p-0")}
                          title="Copy code"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {!row.redeemedAt ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDelete(row.id)}
                            className={cn(
                              buttonVariants({ variant: "ghost", size: "sm" }),
                              "h-8 w-8 p-0 text-red-400 hover:text-red-300",
                            )}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
