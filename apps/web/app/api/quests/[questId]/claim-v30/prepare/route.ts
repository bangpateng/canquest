import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /quests/:questId/claim-v30/prepare — v30:
 * siapkan SATU ExerciseCommand Accept* (ClaimOffer) utk ditandatangani browser.
 * Body: { fcfs?: boolean } — FCFS membuat WinnerDraw+ClaimOffer on-the-fly.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  const body = await req.text();
  return nestWithAccessCookie(
    req,
    `/quests/${questId}/claim-v30/prepare`,
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    },
    { upstreamTimeoutMs: 60_000 },
  );
}
