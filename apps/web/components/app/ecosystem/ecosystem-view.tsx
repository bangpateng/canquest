"use client";

import { NetworkStatsBar } from "@/components/app/ecosystem/network-stats-bar";
import { QuickActions } from "@/components/app/ecosystem/quick-actions";
import { EcosystemProjects } from "@/components/app/ecosystem/ecosystem-projects";

export function EcosystemView() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="type-eyebrow-brand">Canton Ecosystem</p>
        <h1 className="type-page-title">
          Explore the network
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Discover projects, campaigns, and activity on Canton Network.
        </p>
      </div>

      {/* Network stats */}
      <NetworkStatsBar />

      {/* Quick actions */}
      <QuickActions />

      {/* Ecosystem projects grid */}
      <EcosystemProjects />
    </div>
  );
}
