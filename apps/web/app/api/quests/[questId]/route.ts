import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

type Params = { params: Promise<{ questId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { questId } = await params;
  return nestWithAccessCookie(req, `/quests/${questId}`, { method: 'GET' });
}
