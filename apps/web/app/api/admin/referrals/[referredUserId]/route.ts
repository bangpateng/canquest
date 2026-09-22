import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

/**
 * Proxy DELETE referrals/:referredUserId → Nest admin.
 * Revokes a single referral + claws back the referrer's points.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ referredUserId: string }> },
) {
  const { referredUserId } = await params;
  return nestWithAdminAccessCookie(
    req,
    `/admin/referrals/${referredUserId}`,
    { method: 'DELETE' },
  );
}
