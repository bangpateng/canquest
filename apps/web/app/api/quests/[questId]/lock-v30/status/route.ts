import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest GET /quests/:questId/lock-v30/status — status lock campaign v30. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  return nestWithAccessCookie(req, `/quests/${questId}/lock-v30/status`, {
    method: 'GET',
  });
}
