import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy POST /api/party/send-token → Nest POST /party/send-token.
 *
 * P2P token transfer non-CC (USDCx, dll) via CIP-0056 on-chain two-step.
 * Mirror send-cc/route.ts, tapi dengan upstreamTimeoutMs 30s karena submit
 * TransferFactory_Transfer + fee leg two-step bisa lebih lambat dari CC direct.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(
    req,
    '/party/send-token',
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    },
    { upstreamTimeoutMs: 30_000 },
  );
}
