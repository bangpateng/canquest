import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Minta token SSE ephemeral (60s) dari Nest.
 *
 * Frontend (browser) tidak bisa membaca cookie httpOnly `cq_access`, dan
 * EventSource tidak bisa mengirim header Authorization. Jadi route ini
 * (server-side, bisa baca cookie) menukar access token utama → token SSE
 * pendek, lalu frontend connect `api.canquest.cc/api/realtime/stream?token=...`.
 *
 * Token cepat expired (60s) + ditandai `kind:'sse'` di backend → aman di
 * query param (cek apps/api/src/auth/auth.service.ts issueSseToken).
 */
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/auth/sse-token', { method: 'POST' });
}
