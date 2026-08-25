import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /quests/:questId/claim-external/prepare — M3b:
 * siapkan fee leg klaim (semua tipe campaign) untuk user external.
 * Body: { claimType: 'fcfs' | 'draw_cc' | 'invite' | 'cc_code_raffle' }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  const body = await req.text();
  return nestWithAccessCookie(
    req,
    `/quests/${questId}/claim-external/prepare`,
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    },
    { upstreamTimeoutMs: 60_000 },
  );
}
