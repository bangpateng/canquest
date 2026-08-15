'use client';
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { apiFetch, ApiError } from "@/lib/services/api/client";

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/utils';

export function AdminLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/api/admin/auth/login', {
        method: 'POST',
        json: { email: email.trim(), password },
      });

      router.push(next && next.startsWith('/admin') ? next : '/admin');
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : 'Sign-in failed — try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    'w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm outline-none ring-[var(--ring)] transition-shadow focus-visible:ring-2';

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Email</label>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Password</label>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </div>
      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className={cn(
          cn(buttonVariants(), 'w-full gap-2'),
        )}
      >
        {loading ? <LoadingSpinner size="md" aria-hidden /> : null}
        Sign in
      </button>
      <p className="text-center text-xs text-[var(--muted-foreground)]">
        Use <span className="font-mono">ADMIN_PANEL_EMAIL</span> and{' '}
        <span className="font-mono">ADMIN_PANEL_PASSWORD</span> in{' '}
        <span className="font-mono">apps/api/.env</span>.
      </p>
      <p className="text-center text-xs">
        <Link href="/?auth=login" className="text-[var(--primary)] underline-offset-4 hover:underline">
          User app login
        </Link>
      </p>
    </form>
  );
}
