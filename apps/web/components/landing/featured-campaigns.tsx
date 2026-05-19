import { Calendar, Users } from "lucide-react";

const campaigns = [
  {
    name: "Canton Builder Season",
    org: "Network Initiative",
    reward: "150k points pool",
    participants: "12.4k",
    ends: "Jun 12",
  },
  {
    name: "Institutional Onboarding",
    org: "CanQuest Labs",
    reward: "WL + CC allocation",
    participants: "4.1k",
    ends: "May 28",
  },
  {
    name: "Validator Education",
    org: "Ecosystem Fund",
    reward: "Spin tickets",
    participants: "8.9k",
    ends: "Jul 01",
  },
];

export function FeaturedCampaigns() {
  return (
    <section
      id="campaigns"
      className="border-b border-[var(--border)] bg-[var(--muted)]/40 py-20"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-10 max-w-2xl">
          <h2 className="font-[family-name:var(--font-space)] text-3xl font-semibold tracking-tight sm:text-4xl">
            Featured campaigns
          </h2>
          <p className="mt-3 text-[var(--muted-foreground)]">
            High-signal programs with clear reward economics and transparent
            participation—presented in a layout your compliance team will not
            cringe at.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {campaigns.map((c) => (
            <article
              key={c.name}
              className="group glass-card flex flex-col rounded-2xl p-6 transition-shadow duration-300 hover:shadow-lg"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                    {c.org}
                  </p>
                  <h3 className="mt-1 font-[family-name:var(--font-space)] text-lg font-semibold">
                    {c.name}
                  </h3>
                </div>
                <span className="rounded-lg bg-[var(--primary)]/15 px-2 py-1 text-xs font-medium text-[var(--foreground)]">
                  Live
                </span>
              </div>
              <p className="text-sm text-[var(--muted-foreground)]">{c.reward}</p>
              <div className="mt-6 flex items-center justify-between border-t border-[var(--border)] pt-4 text-sm text-[var(--muted-foreground)]">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  {c.participants}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  {c.ends}
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
