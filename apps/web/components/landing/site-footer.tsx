import Link from "next/link";
import { CanQuestLogo } from "@/components/brand/canquest-logo";
import { LandingShell } from "@/components/landing/landing-shell";
import { getSiteSocialLinks } from "@/lib/site-config";
import { cn } from "@/lib/utils";

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-4 w-4 fill-current", className)}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const links = [
  { href: "#campaigns", label: "Quests" },
  { href: "#features", label: "Platform" },
  { href: "#canton", label: "Canton" },
  { href: "#security", label: "Security" },
  { href: "/overview", label: "App", internal: true },
];

export function SiteFooter() {
  const social = getSiteSocialLinks();
  const twitter = social.find((s) => s.id === "twitter");

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--muted)]/20">
      <LandingShell className="flex flex-col items-start gap-6 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit shrink-0 justify-start">
          <CanQuestLogo size="lg" href="/" />
        </div>

        <nav
          className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted-foreground)]"
          aria-label="Footer"
        >
          {links.map((link) =>
            link.internal ? (
              <Link
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-[var(--foreground)]"
              >
                {link.label}
              </Link>
            ) : (
              <a
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-[var(--foreground)]"
              >
                {link.label}
              </a>
            ),
          )}
        </nav>

        <div className="flex items-center gap-4 sm:justify-end">
          {twitter ? (
            <a
              href={twitter.href}
              target="_blank"
              rel="noreferrer"
              aria-label="X (Twitter)"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-canton-muted hover:text-canton"
            >
              <XIcon />
            </a>
          ) : null}
          <p className="text-xs text-[var(--muted-foreground)]">
            © {new Date().getFullYear()} CanQuest
          </p>
        </div>
      </LandingShell>
    </footer>
  );
}
