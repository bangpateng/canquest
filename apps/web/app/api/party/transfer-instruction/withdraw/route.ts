import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /api/party/transfer-instruction/withdraw.
 *
 * Withdraw (cancel) sebuah outgoing TransferInstruction milik sender. Body:
 *   { transferInstructionCid: string }
 *
 * Timeout 30s — Canton ledger submit butuh lebih lama dari default 15s BFF.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(
    req,
    '/party/transfer-instruction/withdraw',
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    },
    { upstreamTimeoutMs: 30_000 },
  );
}
