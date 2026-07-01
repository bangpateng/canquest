import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

/** Proxy GET users/:userId/referrals → Nest admin (forwards cq_admin_access as Bearer). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/users/${userId}/referrals`, {
    method: 'GET',
  });
}
