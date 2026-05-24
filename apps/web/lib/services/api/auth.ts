import { apiFetch } from './client';

export interface Me {
  id?: string;
  email?: string;
  displayName?: string | null;
  username?: string | null;
  cantonPartyId?: string | null;
  avatarUrl?: string | null;
}

export function login(email: string, password: string) {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    json: { email: email.trim().toLowerCase(), password },
  });
}

export function register(params: {
  displayName: string;
  email: string;
  password: string;
  inviteCode?: string;
}) {
  return apiFetch<Record<string, unknown>>('/api/auth/register', {
    method: 'POST',
    json: {
      displayName: params.displayName.trim(),
      email: params.email.trim().toLowerCase(),
      password: params.password,
      inviteCode: params.inviteCode?.trim() || undefined,
    },
  });
}

export function verifyOtp(userId: string, otp: string) {
  return apiFetch('/api/auth/verify-otp', {
    method: 'POST',
    json: { userId, otp },
  });
}

export function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export function getMe() {
  return apiFetch<Me>('/api/me', { signal: AbortSignal.timeout(8_000) });
}
