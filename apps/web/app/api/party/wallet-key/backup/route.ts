import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** GET /api/party/wallet-key/backup — ambil blob terenkripsi (device baru). */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/wallet-key/backup', {
    method: 'GET',
  });
}

/** PUT /api/party/wallet-key/backup — simpan/perbarui blob (sync ON). */
export async function PUT(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/wallet-key/backup', {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** DELETE /api/party/wallet-key/backup — hapus blob (sync OFF). */
export async function DELETE(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/wallet-key/backup', {
    method: 'DELETE',
  });
}
