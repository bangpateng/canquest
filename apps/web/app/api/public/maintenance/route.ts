import { NextResponse } from 'next/server';

import { internalApiBase } from '@/lib/api/internal-api-url';

/**
 * GET /api/public/maintenance — BFF proxy ke Nest GET /api/public/maintenance.
 *
 * Publik (tanpa auth) supaya overlay client & middleware Next bisa membaca status
 * walau user belum login. Tidak ada rate-limit di sisi BFF; backend endpoint
 * sudah @SkipThrottle dan service-nya cache 5 detik.
 */
export async function GET() {
  try {
    const upstream = await fetch(`${internalApiBase()}/public/maintenance`, {
      cache: 'no-store',
    });
    const text = await upstream.text();
    let data: unknown = { enabled: false };
    try {
      data = text ? JSON.parse(text) : { enabled: false };
    } catch {
      data = { enabled: false };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    // Fail-open: bila API unreachable, anggap OFF (jangan blokir pengguna).
    return NextResponse.json({ enabled: false }, { status: 200 });
  }
}
