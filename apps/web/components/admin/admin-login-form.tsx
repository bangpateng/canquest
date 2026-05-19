'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      let data: { message?: string | string[] } = {};
      try {
        data = (await res.json()) as { message?: string };
      } catch {
        /* empty */
      }

      if (!res.ok) {
        let msg: string;
        if (Array.isArray(data.message)) {
          msg = data.message.map(String).join('; ');
        } else if (typeof data.message === 'string') {
          msg = data.message;
        } else {
          msg = 'Sign-in failed.';
        }
        setError(msg);
        return;
      }

      router.push(next && next.startsWith('/admin') ? next : '/admin');
      router.refresh();
    } catch {
      setError('Network error — try again.');
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
          'flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-60',
        )}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Sign in
      </button>
      <p className="text-center text-xs text-[var(--muted-foreground)]">
        Use <span className="font-mono">ADMIN_PANEL_EMAIL</span> and{' '}
        <span className="font-mono">ADMIN_PANEL_PASSWORD</span> in{' '}
        <span className="font-mono">apps/api/.env</span>.
      </p>
      <p className="text-center text-xs">
        <Link href="/login" className="text-[var(--primary)] underline-offset-4 hover:underline">
          User app login
        </Link>
      </p>
    </form>
  );
}
