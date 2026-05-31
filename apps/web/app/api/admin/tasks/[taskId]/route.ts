import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';
type P = { params: Promise<{ taskId: string }> };
export async function PATCH(req: NextRequest, { params }: P) {
  const { taskId } = await params;
  const body = await req.text();
  return nestWithAdminAccessCookie(req, `/admin/tasks/${taskId}`, { method: 'PATCH', body, headers: { 'Content-Type': 'application/json' } });
}
export async function DELETE(req: NextRequest, { params }: P) {
  const { taskId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/tasks/${taskId}`, { method: 'DELETE' });
}
