import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  // M3b: body optional { externalFeeTxId } utk user external (fee di-sign browser).
  const body = await req.text().catch(() => '');
  return nestWithAccessCookie(req, `/quests/${questId}/claim-fcfs`, {
    method: 'POST',
    ...(body
      ? { body, headers: { 'Content-Type': 'application/json' } }
      : {}),
  }, { upstreamTimeoutMs: 90_000 });
}
