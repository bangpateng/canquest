import { CanQuestLogo } from "@/components/brand/canquest-logo";
import { LandingShell } from "@/components/landing/landing-shell";
import { getSiteSocialLinks } from "@/lib/site-config";

export function SiteFooter() {
  const social = getSiteSocialLinks();

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--background)]">
      <LandingShell className="flex flex-col gap-6 py-10 md:py-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CanQuestLogo size="md" href="/" />
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
        </div>

        <p className="text-xs text-[var(--muted-foreground)]">
          © {new Date().getFullYear()} CanQuest
        </p>
      </LandingShell>
    </footer>
  );
}
