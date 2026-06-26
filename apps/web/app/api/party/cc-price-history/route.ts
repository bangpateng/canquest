import { NextResponse } from "next/server";

/**
 * 24h CC price history (kline) from Bybit, for the Overview sparkline.
 *
 * Pakai endpoint Bybit v5 /market/kline, interval 1 jam, limit 25 candle →
 * ±24 jam terakhir. Karena ini data history pasar (bukan sesi browser),
 * grafik tetap sama walau halaman di-refresh.
 *
 * Response: { prices: number[], ts: number[] } (urut naik waktu).
 */
const CC_KLINE_API_URL =
  "https://api.bytick.com/v5/market/kline?category=spot&symbol=CCUSDT&interval=60&limit=25";

export const runtime = "edge";
export const revalidate = 300; // cache 5 menit di edge

export async function GET() {
  try {
    const res = await fetch(CC_KLINE_API_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { prices: [], source: "bybit_http_error" },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      retCode: number;
      result?: { list?: string[][] };
    };
    // Setiap row: [startTime, open, high, low, close, volume, turnover]
    const rows = data?.result?.list ?? [];
    if (rows.length === 0) {
      return NextResponse.json({ prices: [], source: "bybit_empty" });
    }

    const parsed = rows
      .map((r) => ({ ts: Number(r[0]), close: Number(r[4]) }))
      .filter((p) => Number.isFinite(p.close) && p.close > 0)
      .sort((a, b) => a.ts - b.ts);

    const prices = parsed.map((p) => p.close);
    const ts = parsed.map((p) => p.ts);

    return NextResponse.json({
      prices,
      ts,
      source: "bybit_kline",
    });
  } catch {
    return NextResponse.json(
      { prices: [], source: "bybit_unreachable" },
      { status: 502 },
    );
  }
}
