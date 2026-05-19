import type { ReactNode } from "react";
import Link from "next/link";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-[var(--background)]">
      <div className="gradient-mesh particle-field pointer-events-none absolute inset-0 opacity-[0.35]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-14 sm:py-20">
        <Link
          href="/"
          className="mb-10 flex flex-col items-center gap-3 text-center font-[family-name:var(--font-space)] text-xl font-semibold tracking-tight text-[var(--foreground)] hover:opacity-90"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG asset in /public */}
          <img
            src="/canquest-mark.svg"
            alt=""
            width={56}
            height={56}
            className="h-14 w-14"
          />
          <span>CanQuest</span>
        </Link>
        {children}
        <p className="mt-10 text-center text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          Sign-in and registration go through this app’s API routes and your CanQuest backend; credentials are
          not sent directly from the browser to third parties.
        </p>
      </div>
    </div>
  );
}