import Link from "next/link";
import { CanQuestLogo } from "@/components/ui/canquest-logo";
import { LandingShell } from "@/components/landing/landing-shell";
import { getSiteSocialLinks } from "@/lib/config/site-config";

export function SiteFooter() {
  const social = getSiteSocialLinks();

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--background)]">
      <LandingShell className="flex flex-col gap-6 py-10 md:py-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-sm">
            <CanQuestLogo size="md" href="/" />
            
          </div>
          <nav
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted-foreground)]"
            aria-label="Footer links"
          >
            <Link href="/docs" className="transition-colors hover:text-[var(--foreground)]">
              Docs
            </Link>
            <Link href="/cooperation" className="transition-colors hover:text-[var(--foreground)]">
              Cooperation
            </Link>
            <Link href="/brand-kit" className="transition-colors hover:text-[var(--foreground)]">
              Brand Kit
            </Link>
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
        </div>

        <p className="text-xs text-[var(--muted-foreground)]">
          © {new Date().getFullYear()} CanQuest
        </p>
      </LandingShell>
    </footer>
  );
}
