import Link from "next/link";
import { DOCS_NAV } from "@/components/docs/docs-nav";
import { cn } from "@/lib/utils";

function DocsNavItems({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  return (
    <ul className={cn("space-y-1", className)}>
      {DOCS_NAV.map((item) => (
        <li key={item.id}>
          <Link
            href={`#${item.id}`}
            onClick={onNavigate}
            className="block rounded-md px-2 py-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)]"
          >
            {item.title}
          </Link>
          {item.children && item.children.length > 0 ? (
            <ul className="mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-3 ml-2">
              {item.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={`#${child.id}`}
                    onClick={onNavigate}
                    className="block rounded-md px-2 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)]"
                  >
                    {child.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Sticky sidebar for desktop documentation layout. */
export function DocsSidebar() {
  return (
    <aside
      className="hidden w-56 shrink-0 lg:block xl:w-60"
      aria-label="Documentation navigation"
    >
      <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto border-r border-[var(--border)] pb-8 pr-6">
        <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          On this page
        </p>
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
          On this page
          <span
            className="text-xs text-[var(--muted-foreground)] transition-transform group-open:rotate-180"
            aria-hidden
          >
            ▼
          </span>
        </span>
      </summary>
      <nav className="border-t border-[var(--border)] px-2 py-3" aria-label="Documentation navigation">
        <DocsNavItems />
      </nav>
    </details>
  );
}
