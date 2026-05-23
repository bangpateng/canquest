import { type NextRequest, NextResponse } from 'next/server';

import { internalApiBase } from '@/lib/internal-api-url';

type Params = { params: Promise<{ userId: string }> };

/** Public profile photo — proxied from API uploads storage. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    return new NextResponse(null, { status: 404 });
  }

  const upstream = await fetch(`${internalApiBase()}/uploads/avatars/${userId}`, {
    cache: 'no-store',
  });

  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status });
  }

  const bytes = await upstream.arrayBuffer();
  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
