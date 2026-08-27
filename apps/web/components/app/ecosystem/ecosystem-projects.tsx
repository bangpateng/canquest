"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ExternalLink, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";
import {
  CANTON_PROJECTS,
  ECOSYSTEM_CATEGORIES,
  type EcosystemProject,
} from "@/lib/ecosystem/canton-projects";

const STATUS_DOT: Record<string, string> = {
  live: "bg-emerald-400",
  beta: "bg-amber-400",
  soon: "bg-[var(--muted-foreground)]",
};

const STATUS_LABEL: Record<string, string> = {
  live: "Live",
  beta: "Beta",
  soon: "Soon",
};

function ProjectCard({
  project,
  large = false,
}: {
  project: EcosystemProject;
  large?: boolean;
}) {
  return (
    <Card
      className={cn(
        "group relative gap-0 overflow-hidden border border-[var(--border)] p-0",
        "transition-all duration-300 hover:-translate-y-1 hover:border-[var(--primary)]/30 hover:shadow-[0_8px_32px_-8px_rgb(52_211_153/0.15)]",
        large ? "sm:col-span-2" : "",
      )}
    >
      {/* Gradient banner */}
      <div
        className={cn(
          "relative w-full bg-gradient-to-br",
          project.gradient,
          large ? "h-28" : "h-20",
        )}
        aria-hidden
      >
        {/* Project icon overlay */}
        <div className="absolute bottom-0 left-4 translate-y-1/2">
          <span
            className={cn(
              "flex items-center justify-center rounded-2xl border-2 border-[var(--card-solid)] bg-[var(--card-solid)] shadow-lg",
              large ? "h-14 w-14 text-2xl" : "h-10 w-10 text-lg",
            )}
          >
            {project.icon}
          </span>
        </div>
        {/* Status dot */}
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              STATUS_DOT[project.status],
              project.status === "live" && "animate-pulse",
            )}
          />
          <span className="text-[10px] font-bold uppercase tracking-wide text-white/80">
            {STATUS_LABEL[project.status]}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className={cn("p-4", large ? "pt-7" : "pt-6")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[var(--foreground)]">
              {project.name}
            </p>
            <p className="text-xs font-medium text-[var(--muted-foreground)]">
              {project.symbol} · {project.category}
            </p>
          </div>
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-canton"
            aria-label={`Visit ${project.name}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <p
          className={cn(
            "mt-2 text-xs leading-relaxed text-[var(--muted-foreground)]",
            large ? "line-clamp-3" : "line-clamp-2",
          )}
        >
          {project.description}
        </p>

        {/* Stats row */}
        {project.stats && project.stats.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {project.stats.map((stat) => (
              <span
                key={stat.label}
                className="rounded-lg bg-[var(--muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)]"
              >
                {stat.label}:{" "}
                <span className="text-[var(--foreground)]">{stat.value}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function EcosystemProjects() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [campaignPartners, setCampaignPartners] = useState<EcosystemProject[]>(
    [],
  );

  useEffect(() => {
    fetch("/api/quests", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((quests: Array<{ org?: string; orgSlug?: string }>) => {
        const partners = new Map<string, string>();
        for (const q of quests ?? []) {
          if (q.org && q.orgSlug && !partners.has(q.orgSlug)) {
            partners.set(q.orgSlug, q.org);
          }
        }
        const existing = new Set(
          CANTON_PROJECTS.map((p) => p.name.toLowerCase()),
        );
        const extra: EcosystemProject[] = [];
        for (const [slug, org] of partners) {
          if (
            !existing.has(org.toLowerCase()) &&
            !existing.has(slug.toLowerCase())
          ) {
            extra.push({
              name: org,
              symbol: org.slice(0, 3).toUpperCase(),
              category: "Quest",
              description: `Campaign partner on CanQuest — complete quests to earn CC rewards.`,
              url: `/earn`,
              icon: "🤝",
              gradient: "from-cyan-500/25 via-blue-400/15 to-transparent",
              status: "live",
            });
          }
        }
        setCampaignPartners(extra.slice(0, 4));
      })
      .catch(() => {});
  }, []);

  const all = useMemo(
    () => [...CANTON_PROJECTS, ...campaignPartners],
    [campaignPartners],
  );

  const filtered = useMemo(() => {
    let list = all;
    if (category !== "All") {
      list = list.filter((p) => p.category === category);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      );
    }
    return list;
  }, [all, category, query]);

  const featured = filtered.filter((p) => p.featured);
  const regular = filtered.filter((p) => !p.featured);

  return (
    <section>
      {/* Header */}
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="type-eyebrow-brand">Ecosystem</p>
          <h2 className="type-section-title">Canton Projects</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {all.length} projects building on Canton Network
          </p>
        </div>
      </div>

      {/* Search + Category filter */}
      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, categories..."
            className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] py-3 pl-11 pr-4 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]/40"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {ECOSYSTEM_CATEGORIES.map((cat) => {
            const active = category === cat;
            const count =
              cat === "All"
                ? all.length
                : all.filter((p) => p.category === cat).length;
            if (count === 0 && cat !== "All") return null;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all",
                  active
                    ? "border-[var(--primary)]/40 bg-[var(--primary)]/10 text-canton"
                    : "border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:border-[var(--primary)]/20 hover:text-[var(--foreground)]",
                )}
              >
                {cat}
                <span className="ml-1 opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Featured projects (large cards) */}
      {featured.length > 0 ? (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {featured.map((project) => (
            <ProjectCard
              key={`${project.name}-featured`}
              project={project}
              large
            />
          ))}
        </div>
      ) : null}

      {/* Regular projects */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {regular.map((project) => (
          <ProjectCard key={`${project.name}-${project.symbol}`} project={project} />
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] py-12 text-center">
          <Search className="mx-auto h-8 w-8 text-[var(--muted-foreground)]" />
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            No projects match &quot;{query}&quot;
          </p>
        </div>
      ) : null}

      {/* Submit CTA */}
      <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] p-5 text-center">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Building on Canton?
        </p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Launch a campaign on CanQuest to reach verified users.
        </p>
        <a
          href="/cooperation"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-canton hover:underline"
        >
          Partner with us
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </section>
  );
}
