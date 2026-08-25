import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /quests/:questId/claim-fcfs/prepare-external — M3b:
 * siapkan fee leg klaim FCFS untuk user external (hash utk di-sign browser).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  return nestWithAccessCookie(
    req,
    `/quests/${questId}/claim-fcfs/prepare-external`,
    { method: 'POST' },
    { upstreamTimeoutMs: 60_000 },
  );
}
