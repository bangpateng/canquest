import { type NextRequest, NextResponse } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  return nestWithAccessCookie(req, '/auth/me/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function DELETE(req: NextRequest) {
  return nestWithAccessCookie(req, '/auth/me/avatar', { method: 'DELETE' });
}
