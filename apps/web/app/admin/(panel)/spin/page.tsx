"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Pencil, X, Check, AlertCircle, Ticket } from "lucide-react";
import { cn } from "@/lib/utils/utils";

interface SpinItem {
  id: string;
  label: string;
  rewardType: string;
  rewardCc: number;
  rewardPoints: number;
  probability: number;
  color: string;
  icon: string;
  inventory: number | null;
  wonCount: number;
}

interface SpinStats {
  totalSpins: number;
  ccDelivered: number;
  pending: number;
}

const REWARD_TYPES = [
  { value: "none", label: "No reward (miss)" },
  { value: "points", label: "Bonus Points" },
  { value: "cc", label: "CC (Canton Coin)" },
  { value: "invite_code", label: "Invite Code" },
];

const inputCls =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2 text-sm font-medium text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--primary)]/40 placeholder:text-[var(--muted-foreground)]";

const emptyForm = {
  label: "",
  rewardType: "none",
  rewardCc: 0,
  rewardPoints: 0,
  probability: 10,
  color: "#6366f1",
  icon: "gift",
  inventory: "",
};

export default function AdminSpinPage() {
  const [items, setItems] = useState<SpinItem[]>([]);
  const [stats, setStats] = useState<SpinStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, statsRes] = await Promise.all([
        fetch("/api/admin/spin/items", { credentials: "include" }),
        fetch("/api/admin/spin/stats", { credentials: "include" }),
      ]);
      if (itemsRes.ok) setItems((await itemsRes.json()) as SpinItem[]);
      if (statsRes.ok) setStats((await statsRes.json()) as SpinStats);
    } catch {
      setError("Failed to load spin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditId(null);
    setForm(emptyForm);
    setSaveError(null);
    setShowForm(true);
  }

  function openEdit(item: SpinItem) {
    setEditId(item.id);
    setForm({
      label: item.label,
      rewardType: item.rewardType,
      rewardCc: item.rewardCc,
      rewardPoints: item.rewardPoints,
      probability: item.probability,
      color: item.color,
      icon: item.icon,
      inventory: item.inventory !== null ? String(item.inventory) : "",
    });
    setSaveError(null);
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        label: form.label.trim(),
        rewardType: form.rewardType,
        rewardCc: Number(form.rewardCc) || 0,
        rewardPoints: Number(form.rewardPoints) || 0,
        probability: Number(form.probability) || 0,
        color: form.color,
        icon: form.icon,
        inventory: form.inventory !== "" ? Number(form.inventory) : null,
      };

      const url = editId
        ? `/api/admin/spin/items/${editId}`
        : "/api/admin/spin/items";
      const method = editId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        setSaveError(data.message ?? "Failed to save item.");
        return;
      }

      setShowForm(false);
      setEditId(null);
      await load();
    } catch {
      setSaveError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteId(id);
    try {
      await fetch(`/api/admin/spin/items/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      await load();
    } finally {
      setDeleteId(null);
    }
  }

  async function handleToggleActive(item: SpinItem) {
    await fetch(`/api/admin/spin/items/${item.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    await load();
  }

  const totalProb = items.reduce((s, i) => s + i.probability, 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="type-page-title flex items-center gap-2">
            <Ticket className="h-6 w-6 text-purple-400" />
            Spin &amp; Win
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Manage spin wheel prizes. Total probability must equal 100%.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add Prize
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Spins", value: stats.totalSpins },
            { label: "CC Delivered", value: stats.ccDelivered },
            { label: "Pending", value: stats.pending },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <p className="text-xs font-medium text-[var(--muted-foreground)]">{s.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Probability bar */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between text-sm font-medium">
          <span>Total probability</span>
          <span
            className={cn(
              "font-bold tabular-nums",
              Math.abs(totalProb - 100) < 0.01
                ? "text-emerald-400"
                : totalProb > 100
                  ? "text-red-400"
                  : "text-orange-400",
            )}
          >
            {totalProb.toFixed(1)}% / 100%
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              totalProb > 100 ? "bg-red-500" : "bg-emerald-500",
            )}
            style={{ width: `${Math.min(totalProb, 100)}%` }}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm font-medium text-red-400">{error}</p>
        </div>
      )}

      {/* Items table */}
      {loading ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] py-14 text-center">
          <Ticket className="mx-auto h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="mt-3 font-semibold text-[var(--muted-foreground)]">No spin items yet</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-3 text-sm font-medium text-[var(--primary)] underline-offset-4 hover:underline"
          >
            Add your first prize
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                <th className="px-4 py-3 font-semibold">Prize</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Reward</th>
                <th className="px-4 py-3 font-semibold">Prob %</th>
                <th className="px-4 py-3 font-semibold">Won</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={item.id}
                  className={i % 2 === 0 ? "bg-[var(--card)]" : "bg-[var(--muted)]/20"}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="font-semibold">{item.label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {REWARD_TYPES.find((r) => r.value === item.rewardType)?.label ?? item.rewardType}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {item.rewardType === "cc" && `${item.rewardCc} CC`}
                    {item.rewardType === "points" && `${item.rewardPoints} pts`}
                    {item.rewardType === "none" && "—"}
                    {item.rewardType === "invite_code" && "Code"}
                    {item.inventory !== null && (
                      <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                        (inv: {item.inventory})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold">
                    {item.probability}%
                  </td>
                  <td className="px-4 py-3 tabular-nums text-[var(--muted-foreground)]">
                    {item.wonCount}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(item.id)}
                        disabled={deleteId === item.id}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowForm(false)}
            aria-label="Close"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-bold">
                {editId ? "Edit Prize" : "Add Prize"}
              </h2>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">
                  Label *
                </label>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. 50 CC, Better luck next time"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">
                  Reward Type *
                </label>
                <select
                  value={form.rewardType}
                  onChange={(e) => setForm((f) => ({ ...f, rewardType: e.target.value }))}
                  className={inputCls}
                >
                  {REWARD_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {form.rewardType === "cc" && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">
                    CC Amount *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.rewardCc}
                    onChange={(e) => setForm((f) => ({ ...f, rewardCc: Number(e.target.value) }))}
                    className={inputCls}
                  />
                </div>
              )}

              {form.rewardType === "points" && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">
                    Points Amount *
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.rewardPoints}
                    onChange={(e) => setForm((f) => ({ ...f, rewardPoints: Number(e.target.value) }))}
                    className={inputCls}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">
                    Probability % *
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.1"
                    value={form.probability}
                    onChange={(e) => setForm((f) => ({ ...f, probability: Number(e.target.value) }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">
                    Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--border)] bg-transparent p-0.5"
                    />
                    <input
                      type="text"
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      className={cn(inputCls, "flex-1")}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">
                  Inventory limit{" "}
                  <span className="font-normal text-[var(--muted-foreground)]">(optional — leave blank for unlimited)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.inventory}
                  onChange={(e) => setForm((f) => ({ ...f, inventory: e.target.value }))}
                  placeholder="Unlimited"
                  className={inputCls}
                />
              </div>

              {saveError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-xs font-medium text-red-400">{saveError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !form.label.trim()}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? (
                    "Saving…"
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      {editId ? "Save changes" : "Add prize"}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--muted)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
