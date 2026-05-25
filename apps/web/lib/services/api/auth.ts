import { apiFetch } from './client';

export interface Me {
  id?: string;
  email?: string;
  displayName?: string | null;
  username?: string | null;
  cantonPartyId?: string | null;
  avatarUrl?: string | null;
}

export function login(email: string, turnstileToken: string) {
  return apiFetch<Record<string, unknown>>('/api/auth/login', {
    method: 'POST',
    json: { email: email.trim().toLowerCase(), turnstileToken },
  });
}

export function register(params: {
  email: string;
  twitterUsername: string;
  referralCode?: string;
  turnstileToken: string;
}) {
  const handle = params.twitterUsername.trim().replace(/^@/, '');
  return apiFetch<Record<string, unknown>>('/api/auth/register', {
    method: 'POST',
    json: {
      email: params.email.trim().toLowerCase(),
      twitterUsername: handle,
      referralCode: params.referralCode?.trim() || undefined,
      turnstileToken: params.turnstileToken,
    },
  });
}

export function verifyOtp(userId: string, code: string) {
  return apiFetch('/api/auth/verify-otp', {
    method: 'POST',
    json: { userId, code: code.trim() },
  });
}

export function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export function getMe() {
  return apiFetch<Me>('/api/me', { signal: AbortSignal.timeout(8_000) });
}
