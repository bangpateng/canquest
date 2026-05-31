import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';
export async function GET(req: NextRequest) {
  return nestWithAdminAccessCookie(req, '/admin/stats', { method: 'GET' });
}