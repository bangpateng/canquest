import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest POST /quests/:questId/lock-v30/prepare — hash AcceptLock utk browser. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  return nestWithAccessCookie(
    req,
    `/quests/${questId}/lock-v30/prepare`,
    { method: 'POST' },
    { upstreamTimeoutMs: 60_000 },
  );
}
