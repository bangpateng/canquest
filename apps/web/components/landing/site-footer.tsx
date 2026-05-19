import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="py-14">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="font-[family-name:var(--font-space)] text-lg font-semibold">
            CanQuest
          </p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            © {new Date().getFullYear()} CanQuest. Enterprise quest infrastructure.
          </p>
        </div>
        <div className="flex flex-wrap gap-6 text-sm text-[var(--muted-foreground)]">
          <Link href="/dashboard" className="hover:text-[var(--foreground)]">
            App
          </Link>
          <a href="#features" className="hover:text-[var(--foreground)]">
            Platform
          </a>
          <a
            href="https://docs.digitalasset.com/build/3.5/index.html"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--foreground)]"
          >
            Documentation
          </a>
        </div>
      </div>
    </footer>
  );
}
