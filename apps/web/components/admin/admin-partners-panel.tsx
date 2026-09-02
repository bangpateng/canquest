"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EcoImageField } from "@/components/admin/eco-image-field";

type SocialLink = { platform: string; url: string };
type TeamSocial = { platform: string; url: string };
type TeamMember = {
  initials: string;
  name: string;
  role: string;
  photoUrl: string;
  socials: TeamSocial[];
};
type ValidatorRow = {
  label: string;
  partyId: string;
  network: string;
  status: string;
  explorerUrl: string;
};

type AdminPartnerRow = {
  id: string;
  name: string;
  initials: string;
  logoUrl: string | null;
  category: string;
  categories?: string[];
  about: string;
  website: string | null;
  socialLinks: string;
  team: string;
  appsFeatured: string;
  features: string;
  validators: string;
  published: boolean;
  featuredApp?: boolean;
  likes?: number;
  createdAt: string;
  _count?: { quests?: number };
};

type PartnerFormState = {
  id?: string;
  name: string;
  initials: string;
  logoUrl: string;
  category: string;
  categories: string[];
  about: string;
  website: string;
  published: boolean;
  featuredApp: boolean;
  socialLinks: SocialLink[];
  featuresJson: string;
  appsFeaturedJson: string;
  team: TeamMember[];
  validators: ValidatorRow[];
};

const EMPTY_FORM: PartnerFormState = {
  name: "",
  initials: "",
  logoUrl: "",
  category: "",
  categories: [],
  about: "",
  website: "",
  published: true,
  featuredApp: false,
  socialLinks: [],
  featuresJson: "[]",
  appsFeaturedJson: "[]",
  team: [],
  validators: [],
};

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[rgb(111_230_0/0.45)]";

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeParseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}

/** Parse JSON yang sudah lolos validasi loop di atas — throw bila invalid. */
function jsonOr(raw: string): unknown {
  const parsed = safeParseJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function AddMoreBtn({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] transition-colors hover:border-[rgb(111_230_0/0.4)] hover:bg-[rgb(111_230_0/0.10)] hover:text-canton"
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-red-500 transition-colors hover:bg-red-500/10"
      aria-label="Remove row"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

/** Baris editable social link { platform, url }. */
function SocialRow({
  value,
  onChange,
  onRemove,
}: {
  value: SocialLink;
  onChange: (v: SocialLink) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        className={cn(inputClass, "w-40 shrink-0")}
        value={value.platform}
        placeholder="Platform (x/website/…)"
        onChange={(e) => onChange({ ...value, platform: e.target.value })}
      />
      <input
        className={inputClass}
        value={value.url}
        placeholder="https://…"
        onChange={(e) => onChange({ ...value, url: e.target.value })}
      />
      <RemoveBtn onClick={onRemove} />
    </div>
  );
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
  const [newCat, setNewCat] = useState("");
  const [catBusy, setCatBusy] = useState(false);
  const [categories, setCategories] = useState<
    Array<{ id: string; value: string; label: string }>
  >([]);

  useEffect(() => {
    fetch("/api/admin/ecosystem/categories", { cache: "no-store" })
      .then(async (res) => (res.ok ? res.json() : []))
      .then((cats) => setCategories(cats))
      .catch(() => setCategories([]));
  }, []);

  const categoryLabel = useMemo(
    () => (value: string) =>
      categories.find((c) => c.value === value)?.label ?? value,
    [categories],
  );

  const openNew = () => {
    setForm({
      ...EMPTY_FORM,
      category: categories[0]?.value ?? "",
      categories: categories[0]?.value ? [categories[0].value] : [],
    });
    setFormError(null);
  };
  const openEdit = (r: AdminPartnerRow) => {
    const team = parseJsonArray<TeamMember & { socials?: TeamSocial[] }>(
      r.team,
    ).map((t) => ({
      initials: t.initials ?? "",
      name: t.name ?? "",
      role: t.role ?? "",
      photoUrl: t.photoUrl ?? "",
      socials: t.socials ?? [],
    }));
    const rowCats = (r.categories ?? []).length
      ? (r.categories as string[])
      : r.category
        ? [r.category]
        : [];
    setForm({
      id: r.id,
      name: r.name,
      initials: r.initials,
      logoUrl: r.logoUrl ?? "",
      category: rowCats[0] ?? "",
      categories: rowCats,
      about: r.about,
      website: r.website ?? "",
      published: r.published,
      featuredApp: r.featuredApp ?? false,
      socialLinks: parseJsonArray<SocialLink>(r.socialLinks),
      featuresJson: JSON.stringify(parseJsonArray(r.features)),
      appsFeaturedJson: JSON.stringify(parseJsonArray(r.appsFeatured)),
      team,
      validators: parseJsonArray<ValidatorRow>(r.validators).map((v) => ({
        label: v.label ?? "",
        partyId: v.partyId ?? "",
        network: v.network ?? "",
        status: v.status ?? "",
        explorerUrl: v.explorerUrl ?? "",
      })),
    });
    setFormError(null);
  };

  const save = async () => {
    if (!form) return;
    setFormError(null);
    for (const [label, raw] of [
      ["Features", form.featuresJson],
      ["Apps featured", form.appsFeaturedJson],
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
      category: form.categories[0] ?? "",
      categories: form.categories,
      about: form.about,
      website: form.website.trim() || undefined,
      published: form.published,
      featuredApp: form.featuredApp,
      socialLinks: form.socialLinks.filter((s) => s.platform && s.url),
      features: jsonOr(form.featuresJson),
      appsFeatured: jsonOr(form.appsFeaturedJson),
      team: form.team
        .filter((t) => t.name && t.role)
        .map((t) => ({
          initials: t.initials || t.name.slice(0, 2).toUpperCase(),
          name: t.name,
          role: t.role,
          photoUrl: t.photoUrl.trim() || undefined,
          socials: (t.socials ?? []).filter((s) => s.platform && s.url),
        })),
      validators: form.validators
        .filter((v) => v.label && v.partyId)
        .map((v) => ({
          label: v.label,
          partyId: v.partyId,
          network: v.network.trim() || undefined,
          status: v.status.trim() || undefined,
          explorerUrl: v.explorerUrl.trim() || undefined,
        })),
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

  if (!form) {
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
                <th className="px-4 py-3">Likes</th>
                <th className="px-4 py-3">Campaigns</th>
                <th className="px-4 py-3">Published</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-[var(--muted-foreground)]"
                  >
                    No partners yet — create the first one.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-brand text-xs font-bold text-[var(--foreground)]">
                        {r.initials.slice(0, 2)}
                      </span>
                      <span className="font-medium">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {categoryLabel(r.category)}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {r.likes ?? 0}
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
      </div>
    );
  }

  /* ── Form create/edit ── */
  const upd = <K extends keyof PartnerFormState>(
    key: K,
    value: PartnerFormState[K],
  ) => setForm({ ...form, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgb(13_20_32/0.4)] p-4">
      <div className="my-8 w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
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

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Name *</span>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => upd("name", e.target.value)}
                placeholder="Kopi Koepat"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Initials * (2–4 chars)</span>
              <input
                className={inputClass}
                value={form.initials}
                maxLength={4}
                onChange={(e) => upd("initials", e.target.value)}
                placeholder="KO"
              />
            </label>
            <div className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium">Categories (pilih satu atau lebih, boleh kosong)</span>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => {
                  const active = form.categories.includes(c.value);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        // Satu setForm (bukan dua upd berurutan — yang kedua
                        // menimpa balik state pertama dgn snapshot lama).
                        const next = active
                          ? form.categories.filter((v) => v !== c.value)
                          : [...form.categories, c.value];
                        setForm({ ...form, categories: next, category: next[0] ?? "" });
                      }}
                      className={cn(
                        "rounded-full border px-3 py-[5px] text-[11.5px] font-semibold transition-colors",
                        active
                          ? "border-[rgb(111_230_0/0.40)] bg-[rgb(111_230_0/0.12)] text-canton"
                          : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[rgb(111_230_0/0.35)]",
                      )}
                    >
                      {active ? "✓ " : ""}
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  className={cn(inputClass, "max-w-56")}
                  value={newCat}
                  placeholder="Kategori baru (mis. Infrastructure)"
                  onChange={(e) => setNewCat(e.target.value)}
                />
                <button
                  type="button"
                  disabled={catBusy || !newCat.trim()}
                  onClick={async () => {
                    setCatBusy(true);
                    const res = await fetch("/api/admin/ecosystem/categories", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        value: newCat.trim(),
                        label: newCat.trim(),
                      }),
                    });
                    setCatBusy(false);
                    if (res.ok) {
                      const created = (await res.json()) as {
                        value: string;
                      };
                      const list = await fetch("/api/admin/ecosystem/categories", {
                        cache: "no-store",
                      }).then((r) => r.json());
                      setCategories(list);
                      upd("categories", [...form.categories, created.value]);
                      setNewCat("");
                    } else {
                      setFormError("Gagal menambah kategori (mungkin sudah ada).");
                    }
                  }}
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0 gap-1.5")}
                >
                  {catBusy ? <LoadingSpinner size="sm" /> : null}
                  + Tambah
                </button>
              </div>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Kategori baru langsung tersedia di dropdown menu Ecosystem.
              </p>
            </div>
            <div className="min-w-0">
              <EcoImageField
                label="Logo (upload / URL)"
                value={form.logoUrl}
                onChange={(v) => upd("logoUrl", v)}
                placeholder="https://… atau klik Upload"
              />
            </div>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">Website</span>
              <input
                className={inputClass}
                value={form.website}
                onChange={(e) => upd("website", e.target.value)}
                placeholder="https://partner.id"
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">About</span>
              <textarea
                className={cn(inputClass, "min-h-[90px]")}
                value={form.about}
                onChange={(e) => upd("about", e.target.value)}
                placeholder="Deskripsi partner untuk tab About…"
              />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => upd("published", e.target.checked)}
              />
              <span className="font-medium">
                Published (tampil di /ecosystem)
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
              <span className="text-sm font-medium">Featured App:</span>
              <div className="inline-flex overflow-hidden rounded-full border border-[var(--border)]">
                {[
                  { val: true, label: "Yes" },
                  { val: false, label: "No" },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => upd("featuredApp", opt.val)}
                    className={cn(
                      "px-4 py-1.5 text-xs font-bold transition-colors",
                      form.featuredApp === opt.val
                        ? opt.val
                          ? "bg-blue-600 text-white"
                          : "bg-[var(--foreground)] text-[var(--background)]"
                        : "bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-[var(--muted-foreground)]">
                Yes = tombol biru "Featured App" muncul setelah nama partner.
              </span>
            </div>
          </div>

          {/* Social links (Add More) */}
          <fieldset className="space-y-2 rounded-xl border border-[var(--border)] p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
              Social links
            </legend>
            {form.socialLinks.map((s, i) => (
              <SocialRow
                key={i}
                value={s}
                onChange={(v) =>
                  upd(
                    "socialLinks",
                    form.socialLinks.map((x, j) => (j === i ? v : x)),
                  )
                }
                onRemove={() =>
                  upd(
                    "socialLinks",
                    form.socialLinks.filter((_, j) => j !== i),
                  )
                }
              />
            ))}
            <AddMoreBtn
              label="Add social link"
              onClick={() =>
                upd("socialLinks", [
                  ...form.socialLinks,
                  { platform: "", url: "" },
                ])
              }
            />
          </fieldset>

          {/* Validators (Add More) */}
          <fieldset className="space-y-2 rounded-xl border border-[var(--border)] p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
              Validators (party IDs)
            </legend>
            {form.validators.map((v, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-lg bg-[var(--background)] p-2.5 sm:grid-cols-2"
              >
                <input
                  className={inputClass}
                  value={v.label}
                  placeholder="Label (Party Validator)"
                  onChange={(e) =>
                    upd(
                      "validators",
                      form.validators.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  className={inputClass}
                  value={v.partyId}
                  placeholder="Party ID (1220a3f9…)"
                  onChange={(e) =>
                    upd(
                      "validators",
                      form.validators.map((x, j) =>
                        j === i ? { ...x, partyId: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  className={inputClass}
                  value={v.network}
                  placeholder="Network (Mainnet)"
                  onChange={(e) =>
                    upd(
                      "validators",
                      form.validators.map((x, j) =>
                        j === i ? { ...x, network: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  className={inputClass}
                  value={v.status}
                  placeholder="Status (Active)"
                  onChange={(e) =>
                    upd(
                      "validators",
                      form.validators.map((x, j) =>
                        j === i ? { ...x, status: e.target.value } : x,
                      ),
                    )
                  }
                />
                <div className="flex gap-2 sm:col-span-2">
                  <input
                    className={inputClass}
                    value={v.explorerUrl}
                    placeholder="Explorer URL (https://…)"
                    onChange={(e) =>
                      upd(
                        "validators",
                        form.validators.map((x, j) =>
                          j === i ? { ...x, explorerUrl: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <RemoveBtn
                    onClick={() =>
                      upd(
                        "validators",
                        form.validators.filter((_, j) => j !== i),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            <AddMoreBtn
              label="Add validator"
              onClick={() =>
                upd("validators", [
                  ...form.validators,
                  {
                    label: "",
                    partyId: "",
                    network: "",
                    status: "",
                    explorerUrl: "",
                  },
                ])
              }
            />
          </fieldset>

          {/* Team (Add More + foto + sosmed per anggota) */}
          <fieldset className="space-y-3 rounded-xl border border-[var(--border)] p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
              Team
            </legend>
            {form.team.map((t, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-lg bg-[var(--background)] p-2.5 sm:grid-cols-2"
              >
                <input
                  className={inputClass}
                  value={t.name}
                  placeholder="Nama *"
                  onChange={(e) =>
                    upd(
                      "team",
                      form.team.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  className={inputClass}
                  value={t.role}
                  placeholder="Role * (Founder)"
                  onChange={(e) =>
                    upd(
                      "team",
                      form.team.map((x, j) =>
                        j === i ? { ...x, role: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  className={inputClass}
                  value={t.initials}
                  maxLength={4}
                  placeholder="Initials (AR — kosong = dari nama)"
                  onChange={(e) =>
                    upd(
                      "team",
                      form.team.map((x, j) =>
                        j === i ? { ...x, initials: e.target.value } : x,
                      ),
                    )
                  }
                />
                <div className="min-w-0">
                  <EcoImageField
                    label="Foto"
                    value={t.photoUrl}
                    onChange={(v) =>
                      upd(
                        "team",
                        form.team.map((x, j) =>
                          j === i ? { ...x, photoUrl: v } : x,
                        ),
                      )
                    }
                    placeholder="URL atau Upload"
                    compact
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <p className="text-[11px] font-semibold text-[var(--muted-foreground)]">
                    Social media anggota:
                  </p>
                  {(t.socials ?? []).map((s, k) => (
                    <SocialRow
                      key={k}
                      value={s}
                      onChange={(v) =>
                        upd(
                          "team",
                          form.team.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  socials: (x.socials ?? []).map((y, l) =>
                                    l === k ? v : y,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      onRemove={() =>
                        upd(
                          "team",
                          form.team.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  socials: (x.socials ?? []).filter(
                                    (_, l) => l !== k,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  ))}
                  <AddMoreBtn
                    label="Add social"
                    onClick={() =>
                      upd(
                        "team",
                        form.team.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                socials: [
                                  ...(x.socials ?? []),
                                  { platform: "", url: "" },
                                ],
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <RemoveBtn
                    onClick={() =>
                      upd(
                        "team",
                        form.team.filter((_, j) => j !== i),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            <AddMoreBtn
              label="Add team member"
              onClick={() =>
                upd("team", [
                  ...form.team,
                  { initials: "", name: "", role: "", photoUrl: "", socials: [] },
                ])
              }
            />
          </fieldset>

          {/* Features & apps — JSON (opsional, lanjutan) */}
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                [
                  "featuresJson",
                  "Features JSON",
                  '[{"title":"Cashback 10%","description":"…"}]',
                ],
                [
                  "appsFeaturedJson",
                  "App featured JSON",
                  '[{"name":"Wallet","description":"…","url":"https://…"}]',
                ],
              ] as Array<[keyof PartnerFormState, string, string]>
            ).map(([key, label, placeholder]) => (
              <label key={key} className="space-y-1 text-sm">
                <span className="font-medium">{label}</span>
                <textarea
                  className={cn(inputClass, "min-h-[60px] font-mono text-xs")}
                  value={form[key] as string}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [key]: e.target.value,
                    } as PartnerFormState)
                  }
                  placeholder={placeholder}
                />
              </label>
            ))}
          </div>
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
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !form.name.trim() || !form.initials.trim()}
            onClick={() => void save()}
            className={buttonVariants({ size: "sm" })}
          >
            <span className="inline-flex items-center gap-2">
              {saving && <LoadingSpinner size="sm" />}
              {saving ? "Saving…" : form.id ? "Save changes" : "Create partner"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
