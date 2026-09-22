import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

/**
 * BFF proxy ke Nest /api/admin/claim-fee.
 * GET  → effective values + which keys are set, PUT → update the setting
 * (guarded by AdminGuard in the backend).
 */
export async function GET(req: NextRequest) {
  return nestWithAdminAccessCookie(req, '/admin/claim-fee', { method: 'GET' });
}

export async function PUT(req: NextRequest) {
  const body = await req.text();
  return nestWithAdminAccessCookie(req, '/admin/claim-fee', {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
