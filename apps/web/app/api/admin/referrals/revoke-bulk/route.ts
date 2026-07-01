import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

/**
 * Proxy POST referrals/revoke-bulk → Nest admin.
 * Body: { referredUserIds?: string[] } | { all?: true }
 * Menghapus banyak referral + clawback massal di server (untuk ribuan item).
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAdminAccessCookie(req, '/admin/referrals/revoke-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
