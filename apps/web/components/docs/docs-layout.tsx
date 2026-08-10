import type { ReactNode } from "react";
import { DocsMobileNav, DocsSidebar } from "@/components/docs/docs-sidebar";
import { LandingShell } from "@/components/landing/landing-shell";

/**
 * Shared two-column docs shell: sticky sidebar (desktop) + content column.
 * Reused by every page under /docs. The marketing route-group layout already
 * wraps this in the site header/footer/auth context.
 */
export function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-[var(--border)]">
      <LandingShell className="py-10 pb-16 md:py-12">
        <div className="flex items-start gap-8 xl:gap-12">
          <DocsSidebar />
          <div className="min-w-0 flex-1">
            <DocsMobileNav />
            {children}
          </div>
        </div>
      </LandingShell>
    </div>
  );
}
