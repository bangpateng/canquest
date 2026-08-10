"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV, docsHref } from "@/components/docs/docs-nav";
import { cn } from "@/lib/utils/utils";

/**
 * Multi-page docs navigation. Active page is derived from the current
 * pathname (not a scroll spy), which is why this is a client component.
 */

function DocsNavItems({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = (slug: string) =>
    slug === "" ? pathname === "/docs" : pathname === `/docs/${slug}`;

  return (
    <nav aria-label="Documentation">
      {DOCS_NAV.map((group, gi) => (
        <div key={gi} className={gi > 0 ? "mt-6" : ""}>
          {group.group ? (
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {group.group}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = current(item.slug);
              return (
                <li key={item.slug}>
                  <Link
                    href={docsHref(item.slug)}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-canton-subtle font-medium text-[rgb(var(--canton-ink))]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)]",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Sticky sidebar for desktop documentation layout. */
export function DocsSidebar() {
  return (
    <aside
      className="hidden w-56 shrink-0 lg:block xl:w-64"
      aria-label="Documentation navigation"
    >
      <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto border-r border-[var(--border)] pb-8 pr-6">
        <DocsNavItems />
        <div className="mt-8 space-y-2 border-t border-[var(--border)] pt-4">
          <Link
            href="/cooperation"
            className="block px-2 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Partnerships
          </Link>
          <Link
            href="/"
            className="block px-2 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    </aside>
  );
}

/** Collapsible nav for mobile / tablet. */
export function DocsMobileNav() {
  return (
    <details className="group mb-8 rounded-xl border border-[var(--border)] bg-[var(--card)] lg:hidden">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--foreground)] marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-2">
          Browse docs
          <span
            className="text-xs text-[var(--muted-foreground)] transition-transform group-open:rotate-180"
            aria-hidden
          >
            ▼
          </span>
        </span>
      </summary>
      <div className="border-t border-[var(--border)] px-2 py-3">
        <DocsNavItems />
      </div>
    </details>
  );
}
