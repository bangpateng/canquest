"use client";

import { useMemo, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { PARTNER_CATEGORIES, partnerCategoryLabel } from "@/components/app/ecosystem/ecosystem-types";

type AdminPartnerRow = {
  id: string;
  name: string;
  initials: string;
  logoUrl: string | null;
  category: string;
  about: string;
  website: string | null;
  socialLinks: string;
  team: string;
  appsFeatured: string;
  features: string;
  published: boolean;
  createdAt: string;
  _count?: { quests?: number };
};

type PartnerFormState = {
  id?: string;
  name: string;
  initials: string;
  logoUrl: string;
  category: string;
  about: string;
  website: string;
  published: boolean;
  socialLinksJson: string;
  featuresJson: string;
  appsFeaturedJson: string;
  teamJson: string;
};

const EMPTY_FORM: PartnerFormState = {
  name: "",
  initials: "",
  logoUrl: "",
  category: "PAYMENTS",
  about: "",
  website: "",
  published: true,
  socialLinksJson: "[]",
  featuresJson: "[]",
  appsFeaturedJson: "[]",
  teamJson: "[]",
};

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[rgb(111_230_0/0.45)]";

function safeParseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}

export function AdminPartnersPanel({
  partners,
  onChanged,
}: {
  partners: unknown[];
  onChanged: () => void;
}) {
  const rows = partners as AdminPartnerRow[];
  const [form, setForm] = useState<PartnerFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openNew = () => {
    setForm({ ...EMPTY_FORM });
    setFormError(null);
  };
  const openEdit = (r: AdminPartnerRow) => {
    setForm({
      id: r.id,
      name: r.name,
      initials: r.initials,
      logoUrl: r.logoUrl ?? "",
      category: r.category,
      about: r.about,
      website: r.website ?? "",
      published: r.published,
      socialLinksJson: JSON.stringify(JSON.parse(r.socialLinks || "[]"), null, 0),
      featuresJson: JSON.stringify(JSON.parse(r.features || "[]"), null, 0),
      appsFeaturedJson: JSON.stringify(JSON.parse(r.appsFeatured || "[]"), null, 0),
      teamJson: JSON.stringify(JSON.parse(r.team || "[]"), null, 0),
    });
    setFormError(null);
  };

  const save = async () => {
    if (!form) return;
    setFormError(null);
    for (const [label, raw] of [
      ["Social links", form.socialLinksJson],
      ["Features", form.featuresJson],
      ["Apps featured", form.appsFeaturedJson],
      ["Team", form.teamJson],
    ] as const) {
      const parsed = safeParseJson(raw);
      if (!parsed.ok) {
        setFormError(`${label}: ${parsed.error}`);
        return;
      }
    }
    const payload = {
      name: form.name.trim(),
      initials: form.initials.trim().toUpperCase(),
      logoUrl: form.logoUrl.trim() || undefined,
      category: form.category,
      about: form.about,
      website: form.website.trim() || undefined,
      published: form.published,
      socialLinks: safeParseJson(form.socialLinksJson).value,
      features: safeParseJson(form.featuresJson).value,
      appsFeatured: safeParseJson(form.appsFeaturedJson).value,
      team: safeParseJson(form.teamJson).value,
    };
    setSaving(true);
    try {
      const res = await fetch(
        form.id ? `/api/admin/partners/${form.id}` : "/api/admin/partners",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { message?: string }
          | null;
        setFormError(body?.message ?? `Save failed (HTTP ${res.status}).`);
        return;
      }
      setForm(null);
      onChanged();
    } catch {
      setFormError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: AdminPartnerRow) => {
    if (
      !window.confirm(
        `Delete partner "${r.name}"? Linked campaigns keep their data (link is cleared).`,
      )
    )
      return;
    const res = await fetch(`/api/admin/partners/${r.id}`, {
      method: "DELETE",
    });
    if (res.ok) onChanged();
  };

  const categoryOptions = useMemo(() => PARTNER_CATEGORIES, []);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={openNew}
        className={cn(buttonVariants({ size: "sm" }), "gap-2")}
      >
        + New partner
      </button>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3">Partner</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Campaigns</th>
              <th className="px-4 py-3">Published</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--muted-foreground)]">
                  No partners yet — create the first one.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-brand text-xs font-bold text-[var(--foreground)]">
                      {r.initials.slice(0, 2)}
                    </span>
                    <span className="font-medium">{r.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {partnerCategoryLabel(r.category)}
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {r._count?.quests ?? 0}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                      r.published
                        ? "bg-[rgb(111_230_0/0.12)] text-canton"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)]",
                    )}
                  >
                    {r.published ? "Published" : "Draft"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      aria-label={`Edit ${r.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(r)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-red-500 hover:bg-red-500/10"
                      aria-label={`Delete ${r.name}`}
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

      {/* ── Form modal ── */}
      {form && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgb(13_20_32/0.4)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setForm(null);
          }}
        >
          <div className="my-8 w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {form.id ? `Edit partner — ${form.name}` : "New partner"}
              </h2>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Name *</span>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Kopi Koepat"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Initials * (2–4 chars)</span>
                <input
                  className={inputClass}
                  value={form.initials}
                  maxLength={4}
                  onChange={(e) => setForm({ ...form, initials: e.target.value })}
                  placeholder="KO"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Category *</span>
                <select
                  className={inputClass}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {categoryOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Logo URL (optional)</span>
                <input
                  className={inputClass}
                  value={form.logoUrl}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                  placeholder="/quest-media/uuid.webp"
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-medium">Website</span>
                <input
                  className={inputClass}
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  placeholder="https://partner.id"
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-medium">About</span>
                <textarea
                  className={cn(inputClass, "min-h-[90px]")}
                  value={form.about}
                  onChange={(e) => setForm({ ...form, about: e.target.value })}
                  placeholder="Deskripsi partner untuk tab About…"
                />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) =>
                    setForm({ ...form, published: e.target.checked })
                  }
                />
                <span className="font-medium">
                  Published (tampil di /ecosystem)
                </span>
              </label>

              {(
                [
                  ["socialLinksJson", "Social links JSON", '[{"platform":"x","url":"https://…"}]'],
                  ["featuresJson", "Features JSON", '[{"title":"Cashback 10%","description":"…"}]'],
                  [
                    "appsFeaturedJson",
                    "App featured JSON",
                    '[{"name":"Wallet","description":"…","url":"https://…"}]',
                  ],
                  [
                    "teamJson",
                    "Team JSON",
                    '[{"initials":"AR","name":"Arif","role":"Founder","socials":[]}]',
                  ],
                ] as Array<[keyof PartnerFormState, string, string]>
              ).map(([key, label, placeholder]) => (
                <label key={key} className="space-y-1 text-sm sm:col-span-2">
                  <span className="font-medium">{label}</span>
                  <textarea
                    className={cn(inputClass, "min-h-[60px] font-mono text-xs")}
                    value={form[key] as string}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    placeholder={placeholder}
                  />
                </label>
              ))}
            </div>

            {formError && (
              <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
                {formError}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForm(null)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !form.name.trim() || !form.initials.trim()}
                onClick={() => void save()}
                className={buttonVariants({ size: "sm" })}
              >
                {saving ? "Saving…" : form.id ? "Save changes" : "Create partner"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
