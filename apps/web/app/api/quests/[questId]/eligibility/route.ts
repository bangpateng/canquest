import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

type Params = { params: Promise<{ questId: string }> };

/**
 * Proxy GET /quests/:questId/eligibility → NestJS (auth via access cookie).
 * Mengembalikan status eligible + alasan untuk badge FE.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { questId } = await params;
  return nestWithAccessCookie(req, `/quests/${questId}/eligibility`, {
    method: 'GET',
  });
}
