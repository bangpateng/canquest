import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { jwtVerify } from 'jose';
import { CQ_ADMIN_ACCESS_COOKIE } from '@/lib/auth-cookies';

function LogoutButton() {
  return (
    <form action="/api/admin/auth/logout" method="post" className="inline">
      <button
        type="submit"
        className="text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
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
    redirect('/admin/login');
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { algorithms: ['HS256'] },
    );
    if (payload.scope !== 'admin-panel' || payload.sub !== 'admin-panel') {
      redirect('/admin/login');
    }
  } catch {
    redirect('/admin/login');
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--card)]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/admin" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-canton-subtle text-xs font-bold text-canton">
                CQ
              </span>
              <span className="type-section-title">
                CanQuest
              </span>
            </Link>
            <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-400">
              Admin
            </span>
          </div>
          <nav className="flex max-w-full flex-wrap items-center justify-end gap-x-5 gap-y-2">
            <Link
              href="/admin"
              className="text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Dashboard
            </Link>
            <Link
              href="/admin/earn"
              className="text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Earn
            </Link>
            <Link
              href="/admin/quest"
              className="text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Quest
            </Link>
            <Link
              href="/admin/users"
              className="text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Users
            </Link>
            <Link
              href="/admin/wallet-invites"
              className="text-sm font-semibold text-canton transition-colors hover:text-[var(--primary-strong)]"
            >
              Wallet codes
            </Link>
            <Link
              href="/overview"
              className="text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-canton"
            >
              App
            </Link>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
