import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MOCK_ACTIVITIES, MOCK_USER } from "@/lib/mock-demo";
import { ArrowUpRight } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "Quest points",
            value: MOCK_USER.points.toLocaleString(),
            hint: "Lifetime points from verified tasks",
          },
          {
            title: "Party binding",
            value: MOCK_USER.username,
            hint: "Placeholder party until Canton sync",
          },
          {
            title: "Weekly rank",
            value: `#${MOCK_USER.weeklyRank}`,
            hint: "Mock ranking — resets Mondays",
          },
        ].map((c) => (
          <div
            key={c.title}
            className="glass-card rounded-2xl border border-[var(--border)] p-6"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              {c.title}
            </p>
            <p className="mt-2 font-[family-name:var(--font-space)] text-3xl font-semibold tracking-tight">
              {c.value}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{c.hint}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-[family-name:var(--font-space)] text-lg font-semibold">
                Recent activity
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Stream that will later come from indexer + SSE/WebSocket.
              </p>
            </div>
            <Link
              href="/transactions"
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "inline-flex shrink-0 gap-1",
              )}
            >
              View all <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="mt-5 divide-y divide-[var(--border)]">
            {MOCK_ACTIVITIES.map((item) => (
              <li
                key={item.title + item.time}
                className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <p className="font-medium text-[var(--foreground)]">{item.title}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">{item.detail}</p>
                </div>
                <p className="shrink-0 text-xs text-[var(--muted-foreground)] sm:pt-0.5">
                  {item.time}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/40 p-6">
          <h2 className="font-[family-name:var(--font-space)] text-lg font-semibold">
            Continue
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Hello, <span className="font-medium text-[var(--foreground)]">{MOCK_USER.displayName}</span>{" "}
            — wrap up onboarding tasks before the vault spin opens.
          </p>
          <div className="mt-auto flex flex-col gap-2">
            <Link href="/quests" className={cn(buttonVariants({ size: "sm" }), "justify-center")}>
              Jump to quests
            </Link>
            <Link
              href="/wallet"
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "justify-center",
              )}
            >
              Preview wallet balances
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
