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
} from "lucide-react";
import { cn } from "@/lib/utils/utils";
import {
  PARTNER_CATEGORIES,
  partnerCategoryLabel,
  type Partner,
} from "./ecosystem-types";

type DetailTab = "about" | "features" | "apps" | "team";

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
        "flex shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-gradient-brand font-[family-name:var(--font-space)] font-bold text-[var(--primary-foreground)]",
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
      !`${p.name} ${partnerCategoryLabel(p.category)} ${p.about}`
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

  return (
    <div>
      {/* ── Hero panel (mockup: kartu dengan blur gradient brand) ── */}
      <div className="relative overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--card)] px-6 py-9 text-center shadow-[var(--shadow-card)]">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-[60px] -top-[70px] h-[240px] w-[240px] rounded-full bg-gradient-brand opacity-[0.16] blur-[36px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-[80px] -left-[40px] h-[200px] w-[200px] rounded-full bg-gradient-brand opacity-10 blur-[36px]"
        />
        <p className="relative text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted-foreground)]">
          Ecosystem
        </p>
        <h1 className="relative mt-1 font-[family-name:var(--font-space)] text-2xl font-bold tracking-[-0.025em] sm:text-3xl">
          Explore the CanQuest ecosystem
        </h1>
        <p className="relative mx-auto mt-1.5 max-w-[520px] text-[13.5px] leading-[1.6] text-[var(--muted-foreground)]">
          Merchants, brands, and communities already connected to CanQuest —
          pay, collect points, and complete quests straight from one wallet.
        </p>
      </div>

      {/* ── Search + kategori — SELALU sejajar satu baris (mobile juga);
            menu dropdown melebar penuh mengikuti toolbar (tidak terpotong). ── */}
      <div
        ref={ddRef}
        className="relative mx-auto flex w-full max-w-3xl flex-row items-center gap-2.5"
      >
        <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 shadow-[var(--shadow-card)] transition-colors focus-within:border-[rgb(111_230_0/0.45)] sm:h-[52px] sm:gap-3 sm:px-5">
          <Search className="h-[18px] w-[18px] shrink-0 text-[var(--muted-foreground)]" />
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
          className="flex h-12 shrink-0 items-center justify-between gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] pl-3.5 pr-3 text-sm font-semibold shadow-[var(--shadow-card)] transition-colors hover:border-[rgb(111_230_0/0.35)] sm:h-[52px] sm:gap-2.5 sm:pl-4"
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
        {ddOpen && (
          <div className="absolute inset-x-0 top-[calc(100%+8px)] z-40 max-h-[320px] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[0_12px_32px_-12px_rgb(13_20_32/0.25)]">
            {[{ value: "all", label: "All Categories" }, ...PARTNER_CATEGORIES].map(
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
      </div>

      {/* ── Section head ── */}
      <div className="flex items-baseline gap-2.5 border-t border-[var(--border)] pt-3">
        <h2 className="font-[family-name:var(--font-space)] text-lg font-semibold tracking-[-0.01em]">
          All Partners
        </h2>
        <span className="text-xs text-[var(--muted-foreground)]">
          {loading ? "…" : `${visible.length} partner${visible.length === 1 ? "" : "s"} shown`}
        </span>
      </div>

      {/* ── Grid partner ── */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[150px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--card)]"
            />
          ))}
        </div>
      ) : error ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          {error}
        </p>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          No partners found{q ? ` for “${query.trim()}”` : ""}.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openDetail(p)}
              className="group flex flex-col rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-4 text-left shadow-[var(--shadow-card)] transition-all duration-300 hover:-translate-y-[3px] hover:border-[rgb(111_230_0/0.30)] hover:shadow-[var(--shadow-card-hover)]"
            >
              <div className="flex items-center gap-3">
                <PartnerLogo partner={p} className="h-11 w-11 text-sm" />
                <h3 className="min-w-0 truncate font-[family-name:var(--font-space)] text-[15px] font-bold leading-tight tracking-[-0.01em]">
                  {p.name}
                </h3>
              </div>
              <p className="mt-2.5 line-clamp-2 text-xs leading-[1.5] text-[var(--muted-foreground)]">
                {cardSummary(p)}
              </p>
              <div className="mt-auto flex items-center justify-between gap-1.5 pt-3">
                <span
                  className={cn(
                    "text-[11px] font-semibold",
                    categoryFamily(p.category).text,
                  )}
                >
                  {partnerCategoryLabel(p.category)}
                </span>
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition-all group-hover:border-[rgb(111_230_0/0.4)] group-hover:bg-[rgb(111_230_0/0.10)] group-hover:text-canton">
                  <ChevronRight className="h-4 w-4" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── CTA bawah (mockup) ── */}
      {!loading && !error && partners.length > 0 && (
        <div className="mt-7 flex justify-center">
          <a
            href="https://www.canton.network/ecosystem"
            target="_blank"
            rel="noopener noreferrer"
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
                className="h-[52px] w-[52px] rounded-[14px] text-base"
              />
              <div className="min-w-0 flex-1">
                <h2 className="font-[family-name:var(--font-space)] text-xl font-bold tracking-[-0.02em]">
                  {selected.name}
                </h2>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {partnerCategoryLabel(selected.category)}
                  {selected.website ? ` · ${selected.website}` : ""}
                </p>
                {selected.socialLinks.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {selected.socialLinks.map((s, i) => (
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
                  ["features", "Features"],
                  ["apps", "App Featured"],
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

              {tab === "features" && (
                <div className="space-y-2">
                  {selected.features.length > 0 ? (
                    selected.features.map((feat, i) => (
                      <div
                        key={i}
                        className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3"
                      >
                        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[rgb(111_230_0/0.10)] text-canton">
                          <Check className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-bold">{feat.title}</p>
                          {feat.description && (
                            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--muted-foreground)]">
                              {feat.description}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="py-4 text-center text-[13px] text-[var(--muted-foreground)]">
                      Partner highlights will be listed here.
                    </p>
                  )}
                </div>
              )}

{tab === "apps" && (
                <div className="space-y-2">
                  {selected.appsFeatured.length > 0 ? (
                    selected.appsFeatured.map((a, i) => (
                      <div
                        key={i}
                        className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3"
                      >
                        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[rgb(0_255_255/0.10)] text-[#00838f]">
                          <Link2 className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-bold">{a.name}</p>
                          {a.description && (
                            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--muted-foreground)]">
                              {a.description}
                            </p>
                          )}
                          {a.url && (
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-canton hover:underline"
                            >
                              Open app <ChevronRight className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="py-4 text-center text-[13px] text-[var(--muted-foreground)]">
                      No featured apps yet.
                    </p>
                  )}
                </div>
              )}

              {tab === "team" && (
                <div className="flex flex-wrap gap-3.5">
                  {selected.team.length > 0 ? (
                    selected.team.map((t, i) => (
                      <div key={i} className="w-[76px] text-center">
                        <div className="mx-auto mb-1.5 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-gradient-brand font-[family-name:var(--font-space)] text-sm font-bold text-[var(--primary-foreground)]">
                          {t.initials.slice(0, 2).toUpperCase()}
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
