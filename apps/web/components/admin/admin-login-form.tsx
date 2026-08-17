'use client';
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { TurnstileField } from "@/components/platform/turnstile-field";
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
  const [totpCode, setTotpCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/api/admin/auth/login', {
        method: 'POST',
        json: {
          email: email.trim(),
          password,
          ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
          ...(turnstileToken ? { turnstileToken } : {}),
        },
      });

      router.push(next && next.startsWith('/admin') ? next : '/admin');
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : 'Sign-in failed — try again.';
      setError(msg);
      // Reset captcha supaya percobaan berikutnya meminta token baru.
      setTurnstileToken(null);
      setCaptchaReset((n) => n + 1);
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
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          Authenticator code{' '}
          <span className="font-normal text-[var(--muted-foreground)]">
            (6-digit, from your 2FA app)
          </span>
        </label>
        <input
          name="totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="123456"
          value={totpCode}
          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={cn(inputCls, 'tracking-[0.3em] text-center font-mono')}
        />
      </div>
      <TurnstileField onToken={setTurnstileToken} resetKey={captchaReset} />
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
        Restricted area — authorized personnel only.
      </p>
      <p className="text-center text-xs">
        <Link href="/?auth=login" className="text-[var(--primary)] underline-offset-4 hover:underline">
          User app login
        </Link>
      </p>
    </form>
  );
}
