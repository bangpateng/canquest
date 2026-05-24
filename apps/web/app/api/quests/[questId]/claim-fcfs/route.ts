import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  return nestWithAccessCookie(req, `/quests/${questId}/claim-fcfs`, {
    method: 'POST',
  }, { upstreamTimeoutMs: 90_000 });
}
