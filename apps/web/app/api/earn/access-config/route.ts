import { NextResponse } from 'next/server';
import { internalApiBase } from '@/lib/api/internal-api-url';

/**
 * Proxy publik ke Nest GET /earn/public/access-config.
 * Mengembalikan biaya points (entryCostPoints) + jumlah CC lock (ccLockAmount).
 * Dipakai oleh card guide di halaman detail Earn.
 */
export async function GET() {
  try {
    const res = await fetch(`${internalApiBase()}/earn/public/access-config`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { entryCostPoints: 200, ccLockAmount: 30 },
        { status: 200 },
      );
    }
    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch {
    // Fallback default kalau API tidak konek.
    return NextResponse.json(
      { entryCostPoints: 200, ccLockAmount: 30 },
      { status: 200 },
    );
  }
}
