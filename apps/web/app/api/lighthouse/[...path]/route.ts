import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const LIGHTHOUSE_BASE = "https://lighthouse.xyz/api";

/**
 * Server-side proxy to 5N Lighthouse Explorer API.
 * Avoids CORS issues when fetching from browser clients.
 *
 * Usage: GET /api/lighthouse/parties/{id}/tx?limit=20
 *        GET /api/lighthouse/parties/{id}/transfers?limit=20
 *        GET /api/lighthouse/parties/{id}/rewards?limit=20
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const pathStr = path.join("/");

  const searchParams = req.nextUrl.searchParams.toString();
  const url = `${LIGHTHOUSE_BASE}/${pathStr}${searchParams ? `?${searchParams}` : ""}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Lighthouse upstream error", status: upstream.status },
        { status: upstream.status },
      );
    }

    // Pass-through Lighthouse response with CORS headers
    return NextResponse.json(data, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, max-age=15, s-maxage=30",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Lighthouse unreachable", detail: String(err) },
      { status: 502 },
    );
  }
}

export async function OPTIONS() {
  return NextResponse.json(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}