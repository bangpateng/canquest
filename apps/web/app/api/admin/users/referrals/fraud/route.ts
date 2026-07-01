import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

/** Proxy GET users/referrals/fraud → Nest admin (forwards cq_admin_access as Bearer). */
export async function GET(req: NextRequest) {
  return nestWithAdminAccessCookie(req, '/admin/users/referrals/fraud', {
    method: 'GET',
  });
}
