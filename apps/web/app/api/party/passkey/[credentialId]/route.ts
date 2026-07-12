import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

/** DELETE /api/party/passkey/:credentialId — remove device (Settings). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ credentialId: string }> },
) {
  const { credentialId } = await params;
  return nestWithAccessCookie(
    req,
    `/party/passkey/${encodeURIComponent(credentialId)}`,
    { method: 'DELETE' },
  );
}
