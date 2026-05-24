import { LandingShell } from "@/components/landing/landing-shell";
import { getSiteSocialLinks } from "@/lib/site-config";

export function SiteFooter() {
  const social = getSiteSocialLinks();

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--muted)]/20">
      <LandingShell className="flex flex-col gap-8 py-10">
        {social.length > 0 ? (
          <nav
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted-foreground)]"
            aria-label="Social links"
          >
            {social.map((link) => (
              <a
                key={link.id}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-[var(--foreground)]"
              >
                {link.label}
              </a>
            ))}
          </nav>
        ) : null}

        <div
          className={
            social.length > 0
              ? "flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)]/80 pt-6"
              : "flex flex-wrap items-center justify-between gap-4"
          }
        >
          <p className="text-xs text-[var(--muted-foreground)]">
            Quest · Earn · Spin Reward · Wallet · Leaderboard
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            © {new Date().getFullYear()} CanQuest
          </p>
        </div>
      </LandingShell>
    </footer>
  );
}
