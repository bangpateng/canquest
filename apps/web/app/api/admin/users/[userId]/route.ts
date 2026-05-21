import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/nest-proxy-admin-access';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/users/${userId}`, {
    method: 'DELETE',
  });
}
