import { apiFetch } from './client';

export interface Me {
  id?: string;
  email?: string;
  displayName?: string | null;
  username?: string | null;
  cantonPartyId?: string | null;
  avatarUrl?: string | null;
  /** Handle X/Twitter yang di-link user (dikembalikan backend, opsional). */
  twitterUsername?: string | null;
  /** Saldo earn-points (dikembalikan backend, opsional). */
  earnPoints?: number;
}

export function login(email: string, password: string, turnstileToken: string) {
  return apiFetch<Record<string, unknown>>('/api/auth/login', {
    method: 'POST',
    json: {
      email: email.trim().toLowerCase(),
      password,
      turnstileToken,
    },
  });
}

/**
 * Google Login — kirim Google ID Token (dari GIS / One Tap) ke BFF.
 * BFF verify+forward ke Nest, set cookie cq_access/cq_refresh.
 *
 * referralCode opsional — diambil dari sessionStorage `canquest_referral_ref`
 * (link ?ref=) atau input manual di form register. Hanya dipakai untuk user
 * baru; existing user → referralCode diabaikan backend.
 */
export function loginWithGoogle(idToken: string, referralCode?: string) {
  return apiFetch<Record<string, unknown>>('/api/auth/google', {
    method: 'POST',
    json: referralCode ? { idToken, referralCode } : { idToken },
  });
}

export function register(params: {
  email: string;
  password: string;
  referralCode?: string;
  turnstileToken: string;
}) {
  return apiFetch<Record<string, unknown>>('/api/auth/register', {
    method: 'POST',
    json: {
      email: params.email.trim().toLowerCase(),
      password: params.password,
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

export function forgotPassword(email: string, turnstileToken: string) {
  return apiFetch<Record<string, unknown>>('/api/auth/forgot-password', {
    method: 'POST',
    json: { email: email.trim().toLowerCase(), turnstileToken },
  });
}

export function resetPassword(email: string, code: string, newPassword: string) {
  return apiFetch<Record<string, unknown>>('/api/auth/reset-password', {
    method: 'POST',
    json: { email: email.trim().toLowerCase(), code: code.trim(), newPassword },
  });
}

export function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export function getMe() {
  return apiFetch<Me>('/api/me', { signal: AbortSignal.timeout(8_000) });
}
