import { type NextRequest, NextResponse } from 'next/server';
import { internalApiBase } from '@/lib/internal-api-url';

export const dynamic = 'force-dynamic';

/** Public leaderboard with Twitter avatar URLs (no login required). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') ?? 'weekly';
  const page = searchParams.get('page') ?? '1';
  const pageSize = searchParams.get('pageSize') ?? '10';

  const url = `${internalApiBase()}/public/leaderboard?period=${encodeURIComponent(period)}&page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`;

  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: 'Invalid leaderboard response' };
    }
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Leaderboard unavailable' }, { status: 502 });
  }
}
