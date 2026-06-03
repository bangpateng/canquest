import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/spin/items/${itemId}`, { method: 'PATCH' });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/spin/items/${itemId}`, { method: 'DELETE' });
}
