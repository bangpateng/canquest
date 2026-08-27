"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";
import { CANTON_PROJECTS, type EcosystemProject } from "@/lib/ecosystem/canton-projects";

const CATEGORY_STYLES: Record<string, string> = {
  DEX: "bg-violet-500/10 text-violet-600",
  Quest: "bg-canton-subtle text-canton",
  Infrastructure: "bg-blue-500/10 text-blue-600",
  Wallet: "bg-amber-500/10 text-amber-600",
  Network: "bg-emerald-500/10 text-emerald-600",
  Data: "bg-pink-500/10 text-pink-600",
};

function ProjectCard({ project }: { project: EcosystemProject }) {
  return (
    <Card
      className={cn(
        "group relative gap-0 overflow-hidden p-0 transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-lg",
        project.featured && "ring-1 ring-[var(--primary)]/20",
      )}
    >
      {/* Accent gradient bar */}
      <div
        className={cn("h-1.5 w-full bg-gradient-to-r", project.accent)}
        aria-hidden
      />

      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--muted)] text-xl">
              {project.icon}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[var(--foreground)]">
                {project.name}
              </p>
              <p className="text-xs font-medium text-[var(--muted-foreground)]">
                {project.symbol}
              </p>
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
              CATEGORY_STYLES[project.category] ??
                "bg-[var(--muted)] text-[var(--muted-foreground)]",
            )}
          >
            {project.category}
          </span>
        </div>

        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
          {project.description}
        </p>

        <a
          href={project.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-canton hover:underline"
        >
          Visit
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </Card>
  );
}

export function EcosystemProjects() {
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
        // Merge partners not already in static list
        const existing = new Set(CANTON_PROJECTS.map((p) => p.name.toLowerCase()));
        const extra: EcosystemProject[] = [];
        for (const [slug, org] of partners) {
          if (!existing.has(org.toLowerCase()) && !existing.has(slug.toLowerCase())) {
            extra.push({
              name: org,
              symbol: org.slice(0, 3).toUpperCase(),
              category: "Quest",
              description: `Campaign partner on CanQuest — complete quests to earn rewards.`,
              url: `/earn`,
              icon: "🤝",
              accent: "from-cyan-500/20 to-blue-500/10",
            });
          }
        }
        setCampaignPartners(extra.slice(0, 3));
      })
      .catch(() => {});
  }, []);

  const all = useMemo(
    () => [...CANTON_PROJECTS, ...campaignPartners],
    [campaignPartners],
  );

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="type-eyebrow-brand">Ecosystem</p>
          <h2 className="type-section-title">Projects on Canton</h2>
        </div>
        <a
          href="https://cctools.network"
          target="_blank"
          rel="noreferrer"
          className="hidden items-center gap-1 text-xs font-semibold text-[var(--muted-foreground)] hover:text-canton sm:flex"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Explore all
        </a>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {all.map((project) => (
          <ProjectCard key={`${project.name}-${project.symbol}`} project={project} />
        ))}
      </div>
    </section>
  );
}
