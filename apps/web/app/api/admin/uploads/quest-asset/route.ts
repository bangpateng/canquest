import { type NextRequest, NextResponse } from 'next/server';

import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;

export async function DELETE(req: NextRequest) {
  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return NextResponse.json({ message: 'Expected JSON body' }, { status: 400 });
  }

  return nestWithAdminAccessCookie(req, '/admin/uploads/quest-asset', {
    method: 'DELETE',
    body: JSON.stringify({ url: body.url }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ message: 'Expected multipart body' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return NextResponse.json({ message: 'Missing file field' }, { status: 400 });
  }

  const f = file as File;
  if (f.size > MAX_BYTES) {
    return NextResponse.json({ message: 'File too large (max 5 MB)' }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append('file', f, f.name || 'upload.jpg');

  // Delegates to nestWithAdminAccessCookie so the x-admin-bff-secret header is
  // attached — nginx rejects direct /api/admin/* calls without it (403), which
  // silently broke every quest logo/banner upload from the admin panel.
  return nestWithAdminAccessCookie(req, '/admin/uploads/quest-asset', {
    method: 'POST',
    body: upstream,
  });
}
