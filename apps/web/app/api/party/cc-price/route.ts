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
        { lastPrice: null, source: "bybit_http_error" },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      retCode: number;
      result?: { list?: Array<{ lastPrice?: string }> };
    };
    const rawPrice = data?.result?.list?.[0]?.lastPrice;
    const lastPrice = rawPrice ? Number(rawPrice) : null;
    return NextResponse.json({
      lastPrice,
      source: lastPrice !== null ? "bybit_realtime" : "bybit_parse_failed",
    });
  } catch {
    return NextResponse.json(
      { lastPrice: null, source: "bybit_unreachable" },
      { status: 502 }
    );
  }
}