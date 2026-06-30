import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

/**
 * BFF proxy ke Nest /api/admin/maintenance.
 * GET  → baca status, PUT → tulis status (di-guard AdminGuard di backend).
 */
export async function GET(req: NextRequest) {
  return nestWithAdminAccessCookie(req, '/admin/maintenance', { method: 'GET' });
}

export async function PUT(req: NextRequest) {
  const body = await req.text();
  return nestWithAdminAccessCookie(req, '/admin/maintenance', {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
