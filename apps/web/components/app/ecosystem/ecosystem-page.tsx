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

const CATEGORY_CHIP_COLORS: Record<string, string> = {
  PAYMENTS: "bg-[rgb(111_230_0/0.10)] text-canton",
  WALLETS: "bg-[rgb(0_255_255/0.12)] text-[#00838f]",
};

function categoryChipClass(category: string): string {
  return (
    CATEGORY_CHIP_COLORS[category] ??
    "bg-[var(--muted)] text-[var(--muted-foreground)]"
  );
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
      {/* ── Intro ── */}
      <div className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted-foreground)]">
          Ecosystem
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-space)] text-2xl font-bold tracking-[-0.025em] sm:text-3xl">
          Explore the CanQuest ecosystem
        </h1>
      </div>

      {/* ── Search + kategori ── */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:flex-row">
        <div className="flex h-[52px] min-w-0 flex-1 items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 shadow-[var(--shadow-card)] transition-colors focus-within:border-[rgb(111_230_0/0.45)]">
          <Search className="h-[18px] w-[18px] shrink-0 text-[var(--muted-foreground)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search partners, categories…"
            className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
          />
        </div>
        <div ref={ddRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setDdOpen((v) => !v)}
            className="flex h-[52px] w-full items-center justify-between gap-3 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 text-sm font-semibold shadow-[var(--shadow-card)] transition-colors hover:border-[rgb(111_230_0/0.35)] sm:w-auto"
          >
            <span className="flex items-center gap-2">
              <span className="h-[7px] w-[7px] rounded-full bg-[var(--primary)]" />
              <span className="max-w-[180px] truncate">{activeCategoryLabel}</span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                ddOpen && "rotate-180",
              )}
            />
          </button>
          {ddOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-40 max-h-[320px] w-60 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[0_12px_32px_-12px_rgb(13_20_32/0.25)]">
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
                      "flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-[13.5px] transition-colors hover:bg-[rgb(111_230_0/0.10)]",
                      category === c.value
                        ? "font-semibold text-canton"
                        : "font-medium text-[var(--foreground)]",
                    )}
                  >
                    {c.label}
                    {category === c.value && (
                      <Check className="ml-auto h-3.5 w-3.5" />
                    )}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Grid partner ── */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[120px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--card)]"
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
                <div className="min-w-0">
                  <p className="truncate font-[family-name:var(--font-space)] text-[15px] font-bold leading-tight">
                    {p.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                    {p.activeQuestCount != null &&
                      `${p.activeQuestCount} active ${
                        p.activeQuestCount === 1 ? "campaign" : "campaigns"
                      }`}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 pt-1">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-[3px] text-[10.5px] font-semibold",
                    categoryChipClass(p.category),
                  )}
                >
                  {partnerCategoryLabel(p.category)}
                </span>
                <span className="ml-auto flex h-[26px] w-[26px] items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition-all group-hover:border-[rgb(111_230_0/0.4)] group-hover:bg-[rgb(111_230_0/0.10)] group-hover:text-canton">
                  <ChevronRight className="h-4 w-4" />
                </span>
              </div>
            </button>
          ))}
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
