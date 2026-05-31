import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { jwtVerify } from 'jose';

import { AdminLoginForm } from '@/components/admin/admin-login-form';
import { CQ_ADMIN_ACCESS_COOKIE } from '@/lib/auth/auth-cookies';

export default async function AdminLoginPage() {
  const jar = await cookies();
  const token = jar.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  const secret = process.env.JWT_ACCESS_SECRET;

  if (token && secret) {
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(secret),
        { algorithms: ['HS256'] },
      );
      if (payload.scope === 'admin-panel' && payload.sub === 'admin-panel') {
        redirect('/admin');
      }
    } catch {
      /* stale cookie — stay on login */
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)] px-4 py-12 text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="text-center">
          <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
            Admin panel
          </span>
          <h1 className="type-page-title mt-3">
            CanQuest Admin
          </h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Sign in with the email and password from your API environment — not the same as a normal app user login.
          </p>
        </div>
        <Suspense fallback={<div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>}>
          <AdminLoginForm />
        </Suspense>
      </div>
    </div>
  );
}
