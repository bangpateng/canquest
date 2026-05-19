import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-space)] text-lg font-semibold tracking-tight"
        >
          CanQuest
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-[var(--muted-foreground)] md:flex">
          <a href="#campaigns" className="hover:text-[var(--foreground)]">
            Campaigns
          </a>
          <a href="#features" className="hover:text-[var(--foreground)]">
            Platform
          </a>
          <a href="#canton" className="hover:text-[var(--foreground)]">
            Canton
          </a>
          <a href="#security" className="hover:text-[var(--foreground)]">
            Security
          </a>
        </nav>
        <div className="flex max-w-[60%] flex-wrap items-center justify-end gap-1.5 sm:max-w-none sm:gap-2">
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "text-xs sm:text-sm",
            )}
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "text-xs sm:text-sm")}
          >
            Register
          </Link>
          <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }), "text-xs sm:text-sm")}>
            Launch app
          </Link>
        </div>
      </div>
    </header>
  );
}
