"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Check,
  ChevronRight,
  Globe,
  X,
  Link2,
  MessageCircle,
  Camera,
  FileText,
  Mail,
  Search,
  Heart,
  ShieldCheck,
  Copy,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { LoadingSpinner, PageLoading } from "@/components/ui/loading-spinner";
import { Card } from "@/components/ui/card";
import {
  PARTNER_CATEGORIES,
  partnerCategoryLabel,
  type Partner,
} from "./ecosystem-types";

type DetailTab = "about" | "validator" | "team";

/**
 * Variasi warna kategori — 4 keluarga warna (green/cyan/violet/amber, mirror
 * mockup ecosystem). Assign deterministik dari nama kategori (jumlah charCode)
 * supaya konsisten antar render — semua kategori dapat warna, bukan cuma 2.
 */
const CATEGORY_COLOR_FAMILIES = [
  {
    chip: "bg-[rgb(111_230_0/0.12)] text-canton",
    text: "text-canton",
    dot: "bg-[var(--primary)]",
  },
  {
    chip: "bg-[rgb(0_255_255/0.14)] text-[#00838f]",
    text: "text-[#00838f]",
    dot: "bg-[#00a8a8]",
  },
  {
    chip: "bg-[rgb(124_58_237/0.10)] text-[#7c3aed]",
    text: "text-[#7c3aed]",
    dot: "bg-[#7c3aed]",
  },
  {
    chip: "bg-[rgb(234_88_12/0.10)] text-[#c2410c]",
    text: "text-[#c2410c]",
    dot: "bg-[#ea580c]",
  },
] as const;

function categoryFamily(category: string) {
  const sum = [...category].reduce((a, c) => a + c.charCodeAt(0), 0);
  return CATEGORY_COLOR_FAMILIES[sum % CATEGORY_COLOR_FAMILIES.length];
}

/** Ringkasan kartu — kalimat pertama about (mirror mockup detail). */
function cardSummary(p: Partner): string {
  const first = (p.about ?? "").split(".")[0]?.trim();
  return first ? `${first}.` : "Partner profile coming soon.";
}

function SocialIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p === "discord") return <MessageCircle className="h-4 w-4" />;
  if (p === "instagram") return <Camera className="h-4 w-4" />;
  if (p === "x" || p === "twitter") return <X className="h-4 w-4" />;
  if (p === "docs" || p === "docs.") return <FileText className="h-4 w-4" />;
  if (p === "email" || p === "mail") return <Mail className="h-4 w-4" />;
  return <Globe className="h-4 w-4" />;
}

/** Logo persegi — gambar bila ada, fallback initials gradient brand. */
function PartnerLogo({
  partner,
  className,
}: {
  partner: Pick<Partner, "logoUrl" | "initials" | "name">;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card-solid)] text-base font-bold text-canton",
        className,
      )}
    >
      {partner.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={partner.logoUrl}
          alt={partner.name}
          className="h-full w-full rounded-[inherit] object-cover"
        />
      ) : (
        partner.initials.slice(0, 2).toUpperCase()
      )}
    </div>
  );
}

export function EcosystemPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Partner | null>(null);
  const [tab, setTab] = useState<DetailTab>("about");
  const [copied, setCopied] = useState<string | null>(null);
  const [categories, setCategories] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [globalSocials, setGlobalSocials] = useState<
    Array<{ platform: string; url: string }>
  >([]);

  useEffect(() => {
    fetch("/api/partners/meta", { credentials: "include" })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((meta) => {
        if (!meta) return;
        if (Array.isArray(meta.categories)) setCategories(meta.categories);
        if (Array.isArray(meta.socialLinks)) setGlobalSocials(meta.socialLinks);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/partners", { credentials: "include", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Partner[]>;
      })
      .then((data) => {
        setPartners(data);
        setError(null);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError("Failed to load partners.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  // Tutup dropdown saat klik luar.
  useEffect(() => {
    if (!ddOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) {
        setDdOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ddOpen]);

  // Escape menutup modal.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [selected]);

  const q = query.trim().toLowerCase();
  const visible = partners.filter((p) => {
    if (category !== "all" && p.category !== category) return false;
    if (
      q &&
      !`${p.name} ${partnerCategoryLabel(p.category, categories)} ${p.about}`
        .toLowerCase()
        .includes(q)
    )
      return false;
    return true;
  });

  const activeCategoryLabel =
    category === "all"
      ? "All Categories"
      : partnerCategoryLabel(category);

  const openDetail = (p: Partner) => {
    setSelected(p);
    setTab("about");
  };

  const toggleLike = async (p: Partner) => {
    // Optimistic — balikin kalau gagal.
    const prev = partners;
    setPartners((list) =>
      list.map((x) =>
        x.id === p.id
          ? { ...x, liked: !x.liked, likes: x.likes + (x.liked ? -1 : 1) }
          : x,
      ),
    );
    try {
      const res = await fetch(`/api/partners/${p.id}/like`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { likes: number; liked: boolean };
      setPartners((list) =>
        list.map((x) =>
          x.id === p.id ? { ...x, likes: data.likes, liked: data.liked } : x,
        ),
      );
    } catch {
      setPartners(prev);
    }
  };

  const copyPartyId = async (partyId: string) => {
    try {
      await navigator.clipboard.writeText(partyId);
      setCopied(partyId);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="w-full max-w-full space-y-4 overflow-hidden sm:space-y-5 md:space-y-6">
      {/* ── Hero — Card standar, left-aligned (mirror hero Earn) ── */}
      <Card className="w-full overflow-hidden">
        <div className="p-6 sm:p-7">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Ecosystem
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight text-[var(--foreground)] sm:text-3xl">
            Exclusive Canton Ecosystem
          </h1>
          <p className="mt-2 max-w-md text-xs font-medium leading-relaxed text-[var(--muted-foreground)] sm:text-sm">
            Be the first to try new projects building on the Canton Network.
            Complete partner quests, gain early access, and earn exclusive
            rewards—all through one wallet.
          </p>
        </div>
      </Card>

      {/* ── Toolbar: search + kategori sejajar SATU BARIS di semua ukuran;
            menu dropdown selebar toolbar (tidak pernah terpotong).
            Mirror pola Card bare p-3/p-4 seperti filter tabs Earn. ── */}
      <Card bare className="relative w-full p-3 sm:p-4" ref={ddRef}>
        <div className="flex w-full items-center gap-2.5 sm:gap-3">
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3.5 transition-colors focus-within:border-[rgb(111_230_0/0.45)] sm:h-11 sm:px-4">
            <Search className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search partners…"
              className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
          <button
            type="button"
            onClick={() => setDdOpen((v) => !v)}
            className={cn(
              "flex h-10 shrink-0 items-center justify-between gap-2 rounded-xl border bg-[var(--card)] px-3 text-[13px] font-semibold shadow-none transition-colors sm:h-11 sm:gap-2.5 sm:px-3.5 sm:text-sm",
              ddOpen
                ? "border-[rgb(111_230_0/0.45)]"
                : "border-[var(--border)] hover:border-[rgb(111_230_0/0.35)]",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "h-[7px] w-[7px] shrink-0 rounded-full transition-colors",
                  category === "all"
                    ? "bg-[var(--primary)]"
                    : categoryFamily(category).dot,
                )}
              />
              <span className="max-w-[92px] truncate sm:max-w-[150px]">
                {activeCategoryLabel}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200",
                ddOpen && "rotate-180",
              )}
            />
          </button>
        </div>
        {ddOpen && (
          <div className="absolute inset-x-3 top-[calc(100%-4px)] z-40 max-h-[320px] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[0_12px_32px_-12px_rgb(13_20_32/0.25)] sm:inset-x-4">
            {[
            {
              value: "all",
              label: "All Categories",
            },
            ...(categories.length > 0 ? categories : PARTNER_CATEGORIES),
          ].map(
              (c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    setCategory(c.value);
                    setDdOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13.5px] transition-colors hover:bg-[rgb(111_230_0/0.10)]",
                    category === c.value
                      ? "font-semibold text-canton"
                      : "font-medium text-[var(--foreground)]",
                  )}
                >
                  <span
                    className={cn(
                      "h-[7px] w-[7px] shrink-0 rounded-full",
                      c.value === "all"
                        ? "bg-[var(--primary)]"
                        : categoryFamily(c.value).dot,
                    )}
                  />
                  {c.label}
                  {category === c.value && (
                    <Check className="ml-auto h-3.5 w-3.5 shrink-0" />
                  )}
                </button>
              ),
            )}
          </div>
        )}
      </Card>

      {/* ── Section head ── */}
      <div className="flex items-baseline gap-2.5">
        <h2 className="font-[family-name:var(--font-space)] text-lg font-semibold tracking-[-0.01em]">
          All Partners
        </h2>
        <span className="text-xs text-[var(--muted-foreground)]">
          {loading ? "…" : `${visible.length} partner${visible.length === 1 ? "" : "s"} shown`}
        </span>
      </div>

      {/* ── List partner vertikal (mockup baru: kartu lebar, logo bulat, tag, like) ── */}
      {loading ? (
        <PageLoading minHeight="min-h-[30vh]" />
      ) : error ? (

        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          {error}
        </p>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          No partners found{q ? ` for “${query.trim()}”` : ""}.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((p) => (
            <Card
              key={p.id}
              interactive
              role="button"
              tabIndex={0}
              onClick={() => openDetail(p)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") openDetail(p);
              }}
              className="flex cursor-pointer flex-col gap-4 px-[22px] pb-5 pt-[22px]"
            >
              <div className="flex items-center gap-3.5">
                <PartnerLogo partner={p} className="h-11 w-11" />
                <h3 className="min-w-0 truncate font-[family-name:var(--font-space)] text-[19px] font-bold tracking-[-0.01em]">
                  {p.name}
                </h3>
                {p.featuredApp && (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-blue-600 px-3 py-1 text-[10.5px] font-bold text-white">
                    Featured App
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {(p.categories ?? (p.category ? [p.category] : []))
                  .filter(Boolean)
                  .slice(0, 3)
                  .map((cat) => (
                  <span
                    key={cat}
                    className={cn(
                      "rounded-full px-3 py-[5px] text-[11.5px] font-semibold",
                      categoryFamily(cat).chip,
                    )}
                  >
                    {partnerCategoryLabel(cat, categories)}
                  </span>
                ))}
                {(p.categories ?? []).length > 3 && (
                  <span className="rounded-full border border-[var(--border)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--muted-foreground)]">
                    +{p.categories.length - 3}
                  </span>
                )}
                {p.activeQuestCount != null && p.activeQuestCount > 0 && (
                  <span className="rounded-full border border-[var(--border)] px-3 py-[5px] text-[11.5px] font-medium text-[var(--foreground)]">
                    {p.activeQuestCount} active{" "}
                    {p.activeQuestCount === 1 ? "campaign" : "campaigns"}
                  </span>
                )}
              </div>
              <p className="line-clamp-2 text-sm leading-[1.55] text-[var(--muted-foreground)]">
                {cardSummary(p)}
              </p>
              <div className="mt-[2px] flex items-center justify-between">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleLike(p);
                  }}
                  aria-label={p.liked ? "Unlike" : "Like"}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-0.5 text-xs font-semibold transition-colors",
                    p.liked
                      ? "text-[rgb(220_38_38)]"
                      : "text-[var(--muted-foreground)] hover:text-[rgb(220_38_38)]",
                  )}
                >
                  <Heart
                    className={cn(
                      "h-4 w-4 transition-transform",
                      p.liked && "scale-110 fill-[rgb(220_38_38)]",
                    )}
                  />
                  {p.likes}
                </button>
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-[var(--border)] text-[var(--muted-foreground)] transition-all group-hover:border-[rgb(111_230_0/0.4)] group-hover:bg-[rgb(111_230_0/0.10)] group-hover:text-canton">
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── CTA bawah (mockup) ── */}
      {!loading && !error && partners.length > 0 && (
        <div className="flex justify-center">
          <a
            href="https://www.canquest.cc/ecosystem"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-[22px] py-3 text-[13.5px] font-semibold shadow-[var(--shadow-card)] transition-all hover:-translate-y-px hover:border-[rgb(111_230_0/0.35)] hover:bg-[rgb(111_230_0/0.10)]"
          >
            View all partners
            <ChevronRight className="h-4 w-4" />
          </a>
        </div>
      )}

      {/* ── Modal detail ── */}
      {selected && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(13_20_32/0.35)] p-4 backdrop-blur-[4px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-[0_24px_60px_-24px_rgb(13_20_32/0.35)]">
            {/* Head: logo ⇒ nama ⇒ sosmed */}
            <div className="flex items-start gap-3.5 px-5 pt-5">
              <PartnerLogo
                partner={selected}
                className="h-[52px] w-[52px]"
              />
              <div className="min-w-0 flex-1">
                <h2 className="font-[family-name:var(--font-space)] text-xl font-bold tracking-[-0.02em]">
                  {selected.name}
                </h2>
                <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-[var(--muted-foreground)]">
                  {(selected.categories ?? (selected.category ? [selected.category] : []))
                    .filter(Boolean)
                    .map((cat) => (
                    <span key={cat} className="text-canton">
                      {partnerCategoryLabel(cat, categories)}
                    </span>
                  ))}
                  {selected.website ? <span>· {selected.website}</span> : null}
                </p>
                {(selected.socialLinks.length > 0
                  ? selected.socialLinks
                  : globalSocials
                ).length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {(selected.socialLinks.length > 0
                      ? selected.socialLinks
                      : globalSocials
                    ).map((s, i) => (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${s.platform}: ${s.url}`}
                        className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[var(--border)] text-[var(--muted-foreground)] transition-all hover:-translate-y-px hover:border-[rgb(111_230_0/0.35)] hover:bg-[rgb(111_230_0/0.10)] hover:text-[var(--foreground)]"
                      >
                        <SocialIcon platform={s.platform} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors hover:bg-[rgb(13_20_32/0.08)] hover:text-[var(--foreground)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="mt-4 flex gap-1.5 border-b border-[var(--border)] px-5">
              {(
                [
                  ["about", "About"],
                  ["validator", "Validator"],
                  ["team", "Team"],
                ] as Array<[DetailTab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] font-semibold transition-colors",
                    tab === key
                      ? "border-primary text-canton"
                      : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              {tab === "about" && (
                <div className="space-y-3 text-[13.5px] leading-[1.7] text-[var(--muted-foreground)]">
                  {selected.about ? (
                    selected.about.split("\n").map((para, i) => (
                      <p key={i}>{para}</p>
                    ))
                  ) : (
                    <p>
                      Profile description for this partner will be available
                      soon.
                    </p>
                  )}
                  {selected.activeQuestCount != null &&
                    selected.activeQuestCount > 0 && (
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-canton">
                        <Link2 className="h-3.5 w-3.5" />
                        {selected.activeQuestCount} active{" "}
                        {selected.activeQuestCount === 1
                          ? "campaign"
                          : "campaigns"}{" "}
                        on Earn
                      </p>
                    )}
                </div>
              )}

              {tab === "validator" && (
                <div className="flex flex-col gap-3">
                  {(selected.validators?.length ?? 0) > 0 ? (
                    selected.validators.map((v, i) => (
                      <div
                        key={i}
                        className="rounded-2xl border border-[var(--border)] bg-gradient-to-b from-[var(--card)] to-[var(--background)] p-4 transition-all hover:-translate-y-px hover:border-[rgb(111_230_0/0.35)] hover:shadow-[var(--shadow-card)]"
                      >
                        <div className="mb-3 flex items-center gap-2.5">
                          <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-gradient-brand text-[var(--primary-foreground)] shadow-[0_6px_14px_-8px_rgb(111_230_0/0.55)]">
                            <ShieldCheck className="h-[17px] w-[17px]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="block text-[13px] font-bold">
                              {v.label}
                            </span>
                            {v.network && (
                              <span className="block text-[10.5px] font-semibold text-[var(--muted-foreground)]">
                                {v.network}
                              </span>
                            )}
                          </div>
                          {v.status && (
                            <span className="inline-flex shrink-0 items-center gap-[5px] rounded-full bg-[rgb(111_230_0/0.10)] px-2.5 py-1 text-[10.5px] font-bold text-canton">
                              <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-[var(--primary)]" />
                              {v.status}
                            </span>
                          )}
                        </div>
                        <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-2.5 py-2">
                          <code className="min-w-0 flex-1 truncate font-[family-name:var(--font-space)] text-[11.5px]">
                            {v.partyId.length > 22
                              ? `${v.partyId.slice(0, 10)}…${v.partyId.slice(-8)}`
                              : v.partyId}
                          </code>
                          <button
                            type="button"
                            onClick={() => void copyPartyId(v.partyId)}
                            title="Copy Party ID"
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-all",
                              copied === v.partyId
                                ? "border-[rgb(111_230_0/0.4)] bg-[rgb(111_230_0/0.10)] text-canton"
                                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-[rgb(111_230_0/0.4)] hover:bg-[rgb(111_230_0/0.10)] hover:text-canton",
                            )}
                          >
                            {copied === v.partyId ? (
                              <Check className="h-[13px] w-[13px]" />
                            ) : (
                              <Copy className="h-[13px] w-[13px]" />
                            )}
                          </button>
                        </div>
                        {v.explorerUrl && (
                          <a
                            href={v.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[rgb(111_230_0/0.3)] bg-[rgb(111_230_0/0.10)] px-3 py-[9px] text-xs font-bold text-canton transition-all hover:border-transparent hover:bg-[var(--primary)] hover:text-[var(--primary-foreground)]"
                          >
                            View on Explorer
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="py-4 text-center text-[13px] text-[var(--muted-foreground)]">
                      Validator party IDs will be listed here.
                    </p>
                  )}
                </div>
              )}

              {tab === "team" && (
                <div className="flex flex-wrap gap-3.5">
                  {selected.team.length > 0 ? (
                    selected.team.map((t, i) => (
                      <div key={i} className="w-[76px] text-center">
                        <div className="mx-auto mb-1.5 flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-full bg-gradient-brand font-[family-name:var(--font-space)] text-sm font-bold text-[var(--primary-foreground)]">
                          {t.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={t.photoUrl}
                              alt={t.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            t.initials.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <p className="text-[11px] font-semibold leading-tight">
                          {t.name}
                        </p>
                        <p className="mt-0.5 text-[9.5px] font-semibold text-canton">
                          {t.role}
                        </p>
                        {(t.socials?.length ?? 0) > 0 && (
                          <div className="mt-1.5 flex justify-center gap-1.5">
                            {t.socials!.map((s, j) => (
                              <a
                                key={j}
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={s.platform}
                                className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-[rgb(111_230_0/0.35)] hover:text-[var(--foreground)]"
                              >
                                <SocialIcon platform={s.platform} />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="w-full py-4 text-center text-[13px] text-[var(--muted-foreground)]">
                      Team members will be listed here.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
