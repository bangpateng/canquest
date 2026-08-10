import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/utils";
import { DOCS_FLAT, docsHref } from "@/components/docs/docs-nav";

/**
 * Shared building blocks for the docs pages, in the OneSwap / Mintlify style:
 * section headings, inline path links, lists, prose wrappers, and the
 * "next steps" card group + prev/next pager used at the foot of pages.
 */

/** A top-level section with an <h2> heading and a hairline divider. */
export function DocsSection({
  id,
  title,
  children,
  className,
}: {
  id?: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 border-b border-[var(--border)] py-9 last:border-b-0 md:py-11",
        className,
      )}
    >
      <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)] sm:text-xl">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-[var(--muted-foreground)]">
        {children}
      </div>
    </section>
  );
}

/** Bold lead-in span, used inside body copy. */
export function Lead({ children }: { children: ReactNode }) {
  return (
    <strong className="font-medium text-[var(--foreground)]">{children}</strong>
  );
}

/** Inline link into the live app (e.g. /wallet). */
export function PathLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="text-canton underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

/** Inline link to another docs page. */
export function DocsLink({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={docsHref(slug)}
      className="text-canton underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  );
}

/** Bulleted list matching the docs body style. */
export function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

/** Numbered list matching the docs body style. */
export function OL({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-2.5 pl-5">{children}</ol>;
}

/**
 * Page header: H1 title + one-sentence subtitle (blockquote), as in the
 * OneSwap docs. The subtitle doubles as the page description / llms.txt entry.
 */
export function DocsHeader({
  eyebrow = "Documentation",
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle: ReactNode;
}) {
  return (
    <header className="mb-2 max-w-2xl">
      <p className="type-eyebrow-brand">{eyebrow}</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
        {subtitle}
      </p>
    </header>
  );
}

/** A single "next steps" card (used inside CardGroup). */
export function DocsCard({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 transition-colors hover:border-canton-muted"
    >
      <p className="text-sm font-semibold text-[var(--foreground)]">
        {title}
        <span className="ml-1 inline-block text-canton transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
        {children}
      </p>
    </Link>
  );
}

/** Two-column grid of next-steps cards, à la Mintlify CardGroup. */
export function CardGroup({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
  );
}

/** Simple key/value reference table. */
export function DocsTable({
  head,
  rows,
}: {
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--muted)]/40">
            {head.map((h, i) => (
              <th
                key={i}
                className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--foreground)]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-[var(--border)] last:border-b-0"
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "px-4 py-2.5 align-top text-[var(--muted-foreground)]",
                    ci === 0 && "font-medium text-[var(--foreground)]",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Prev / next pager at the foot of a page. Derives neighbors from the flat
 * docs order. Pass the current page's slug ("" for index).
 */
export function DocsPager({ currentSlug }: { currentSlug: string }) {
  const idx = DOCS_FLAT.findIndex((i) => i.slug === currentSlug);
  if (idx === -1) return null;
  const prev = idx > 0 ? DOCS_FLAT[idx - 1] : null;
  const next = idx < DOCS_FLAT.length - 1 ? DOCS_FLAT[idx + 1] : null;

  return (
    <nav
      className="mt-12 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-6"
      aria-label="Docs pagination"
    >
      {prev ? (
        <Link
          href={docsHref(prev.slug)}
          className="group rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 transition-colors hover:border-canton-muted"
        >
          <p className="text-xs text-[var(--muted-foreground)]">← Previous</p>
          <p className="mt-0.5 text-sm font-medium text-[var(--foreground)]">
            {prev.title}
          </p>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={docsHref(next.slug)}
          className="group rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-right transition-colors hover:border-canton-muted"
        >
          <p className="text-xs text-[var(--muted-foreground)]">Next →</p>
          <p className="mt-0.5 text-sm font-medium text-[var(--foreground)]">
            {next.title}
          </p>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
