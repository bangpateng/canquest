import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify } from "jose";
import { CQ_ADMIN_ACCESS_COOKIE } from "@/lib/auth/auth-cookies";
import { AdminNav } from "@/components/admin/admin-nav";

function LogoutButton() {
  return (
    <form action="/api/admin/auth/logout" method="post" className="inline">
      <button
        type="submit"
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/30 hover:text-[var(--foreground)]"
      >
        Log out
      </button>
    </form>
  );
}

export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!token || !secret) {
    redirect("/admin/login");
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    if (payload.scope !== "admin-panel" || payload.sub !== "admin-panel") {
      redirect("/admin/login");
    }
  } catch {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-canton-subtle text-xs font-bold text-canton">
              CQ
            </span>
            <span className="type-section-title">Admin</span>
          </Link>
          <form action="/api/admin/auth/logout" method="post">
            <button
              type="submit"
              className="text-xs font-medium text-[var(--muted-foreground)]"
            >
              Log out
            </button>
          </form>
        </div>
        <div className="overflow-x-auto border-t border-[var(--border)]">
          <AdminNav className="flex-row flex-nowrap gap-1 p-2 [&_p]:hidden [&_a]:whitespace-nowrap [&_a]:px-3 [&_a]:py-2" />
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-0 lg:gap-8">
        <aside className="hidden w-56 shrink-0 border-r border-[var(--border)] bg-[var(--card)]/40 lg:block lg:min-h-[calc(100vh-0px)]">
          <div className="sticky top-0 flex h-full flex-col">
            <div className="border-b border-[var(--border)] p-4">
              <Link href="/admin" className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-canton-subtle text-xs font-bold text-canton">
                  CQ
                </span>
                <div>
                  <p className="text-sm font-semibold leading-tight">CanQuest</p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-red-400">Admin</p>
                </div>
              </Link>
            </div>
            <div className="flex-1 overflow-y-auto">
              <AdminNav />
            </div>
            <div className="space-y-2 border-t border-[var(--border)] p-3">
              <Link
                href="/overview"
                className="block rounded-xl px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:text-canton"
              >
                ← Open app
              </Link>
              <LogoutButton />
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
