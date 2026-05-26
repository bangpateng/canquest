import { CQ_ADMIN_ACCESS_COOKIE } from '@/lib/auth-cookies';
import { internalApiBase } from '@/lib/internal-api-url';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return NextResponse.json({ message: 'Expected JSON body' }, { status: 400 });
  }

  const url = `${internalApiBase()}/admin/uploads/quest-asset`;
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: body.url }),
      cache: 'no-store',
    });
    const text = await res.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text || res.statusText };
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'API unreachable';
    return NextResponse.json({ message: `Gateway error: ${message}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

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

  const url = `${internalApiBase()}/admin/uploads/quest-asset`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: upstream,
      cache: 'no-store',
    });
    const text = await res.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text || res.statusText };
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'API unreachable';
    return NextResponse.json({ message: `Gateway error: ${message}` }, { status: 502 });
  }
}
