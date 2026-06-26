import { NextResponse } from "next/server";

const CC_PRICE_API_URL =
  "https://api.bytick.com/v5/market/tickers?category=spot&symbol=CCUSDT";

export const runtime = "edge";

export async function GET() {
  try {
    const res = await fetch(CC_PRICE_API_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { lastPrice: null, change24hPct: null, source: "bybit_http_error" },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      retCode: number;
      result?: {
        list?: Array<{ lastPrice?: string; price24hPcntChange?: string }>;
      };
    };
    const row = data?.result?.list?.[0];
    const rawPrice = row?.lastPrice;
    const lastPrice = rawPrice ? Number(rawPrice) : null;
    // Bybit returns the 24h change as a decimal fraction (e.g. "0.0123" = +1.23%).
    const rawChange = row?.price24hPcntChange;
    const change24hPct =
      rawChange && !Number.isNaN(Number(rawChange)) ? Number(rawChange) * 100 : null;
    return NextResponse.json({
      lastPrice,
      change24hPct,
      source: lastPrice !== null ? "bybit_realtime" : "bybit_parse_failed",
    });
  } catch {
    return NextResponse.json(
      { lastPrice: null, change24hPct: null, source: "bybit_unreachable" },
      { status: 502 }
    );
  }
}