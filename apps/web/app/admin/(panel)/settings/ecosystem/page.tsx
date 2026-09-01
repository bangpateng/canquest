"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, Pencil, Plus, Trash2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type Category = { id: string; value: string; label: string; sortOrder: number };
type SocialLink = { platform: string; url: string };

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[rgb(111_230_0/0.45)]";

export default function AdminEcosystemSettingsPage() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [socials, setSocials] = useState<SocialLink[]>([]);
  const [savingSocials, setSavingSocials] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [newCat, setNewCat] = useState({ value: "", label: "" });
  const [editCat, setEditCat] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [catBusy, setCatBusy] = useState(false);

  const load = useCallback(async () => {
    const [catsRes, settingsRes] = await Promise.all([
      fetch("/api/admin/ecosystem/categories", { cache: "no-store" }),
      fetch("/api/admin/ecosystem/settings", { cache: "no-store" }),
    ]);
    if (catsRes.ok) setCategories(await catsRes.json());
    if (settingsRes.ok) {
      const data = (await settingsRes.json()) as { socialLinks?: SocialLink[] };
      setSocials(data.socialLinks ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addCategory = async () => {
    if (!newCat.value.trim() || !newCat.label.trim()) return;
    setCatBusy(true);
    const res = await fetch("/api/admin/ecosystem/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value: newCat.value.trim(),
        label: newCat.label.trim(),
        sortOrder: (categories?.length ?? 0) + 1,
      }),
    });
    setCatBusy(false);
    if (res.ok) {
      setNewCat({ value: "", label: "" });
      setMessage(null);
      void load();
    } else {
      const body = (await res.json().catch(() => null)) as
        | { message?: string }
        | null;
      setMessage(body?.message ?? "Failed to add category.");
    }
  };

  const saveCategoryLabel = async () => {
    if (!editCat) return;
    setCatBusy(true);
    await fetch(`/api/admin/ecosystem/categories/${editCat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editCat.label }),
    });
    setCatBusy(false);
    setEditCat(null);
    void load();
  };

  const deleteCategory = async (c: Category) => {
    if (!window.confirm(`Delete category "${c.label}"?`)) return;
    const res = await fetch(`/api/admin/ecosystem/categories/${c.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { message?: string }
        | null;
      setMessage(body?.message ?? "Failed to delete category.");
      return;
    }
    setMessage(null);
    void load();
  };

  const saveSocials = async () => {
    setSavingSocials(true);
    const res = await fetch("/api/admin/ecosystem/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        socialLinks: socials.filter((s) => s.platform && s.url),
      }),
    });
    setSavingSocials(false);
    setMessage(res.ok ? "Global social links saved." : "Save failed.");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-brand text-[var(--foreground)]">
          <Globe className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Ecosystem settings
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Kelola kategori direktori & social media global /ecosystem.
          </p>
        </div>
      </div>

      {message && (
        <p className="rounded-lg bg-[rgb(111_230_0/0.10)] px-3 py-2 text-xs font-semibold text-canton">
          {message}
        </p>
      )}

      {/* ── Kategori ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Categories (dropdown & tags)
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            className={cn(inputClass, "w-44")}
            placeholder="Value (mis. PAYMENTS)"
            value={newCat.value}
            onChange={(e) => setNewCat({ ...newCat, value: e.target.value })}
          />
          <input
            className={cn(inputClass, "w-52")}
            placeholder="Label (mis. Payments)"
            value={newCat.label}
            onChange={(e) => setNewCat({ ...newCat, label: e.target.value })}
          />
          <button
            type="button"
            disabled={catBusy}
            onClick={() => void addCategory()}
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>

        {categories === null ? (
          <div
            className="flex min-h-[120px] items-center justify-center"
            role="status"
            aria-live="polite"
          >
            <LoadingSpinner size="2xl" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-4 py-2.5">Label</th>
                  <th className="px-4 py-2.5">Value</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      {editCat?.id === c.id ? (
                        <input
                          className={cn(inputClass, "max-w-56")}
                          value={editCat.label}
                          onChange={(e) =>
                            setEditCat({ ...editCat, label: e.target.value })
                          }
                        />
                      ) : (
                        <span className="font-medium">{c.label}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--muted-foreground)]">
                      {c.value}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        {editCat?.id === c.id ? (
                          <>
                            <button
                              type="button"
                              disabled={catBusy}
                              onClick={() => void saveCategoryLabel()}
                              className={buttonVariants({ size: "sm" })}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditCat(null)}
                              className={buttonVariants({
                                variant: "secondary",
                                size: "sm",
                              })}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setEditCat({ id: c.id, label: c.label })
                              }
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              aria-label={`Edit ${c.label}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteCategory(c)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-red-500 hover:bg-red-500/10"
                              aria-label={`Delete ${c.label}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Social links global ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Global social links
        </h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          Ditampilkan di detail partner yang belum punya social links sendiri.
        </p>
        <div className="space-y-2">
          {socials.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={cn(inputClass, "w-44 shrink-0")}
                placeholder="Platform (x/website/…)"
                value={s.platform}
                onChange={(e) =>
                  setSocials(
                    socials.map((x, j) =>
                      j === i ? { ...x, platform: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                className={inputClass}
                placeholder="https://…"
                value={s.url}
                onChange={(e) =>
                  setSocials(
                    socials.map((x, j) =>
                      j === i ? { ...x, url: e.target.value } : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                onClick={() =>
                  setSocials(socials.filter((_, j) => j !== i))
                }
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-red-500 hover:bg-red-500/10"
                aria-label="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSocials([...socials, { platform: "", url: "" }])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted-foreground)] transition-colors hover:border-[rgb(111_230_0/0.4)] hover:bg-[rgb(111_230_0/0.10)] hover:text-canton"
            >
              <Plus className="h-3.5 w-3.5" /> Add social link
            </button>
            {socials.length > 0 && (
              <button
                type="button"
                disabled={savingSocials}
                onClick={() => void saveSocials()}
                className={cn(buttonVariants({ size: "sm" }), "ml-auto")}
              >
                <span className="inline-flex items-center gap-2">
                  {savingSocials && <LoadingSpinner size="sm" />}
                  {savingSocials ? "Saving…" : "Save social links"}
                </span>
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
