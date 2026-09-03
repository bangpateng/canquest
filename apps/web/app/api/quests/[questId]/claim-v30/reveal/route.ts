import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest POST /quests/:questId/claim-v30/reveal — tampilkan kode reward. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  return nestWithAccessCookie(
    req,
    `/quests/${questId}/claim-v30/reveal`,
    { method: 'POST' },
    { upstreamTimeoutMs: 60_000 },
  );
}
