import { type NextRequest, NextResponse } from "next/server";

/**
 * Lighthouse Explorer API proxy.
 *
 * Proxies GET requests from the browser to the Lighthouse Explorer API to
 * avoid CORS issues. All path segments and query params are forwarded.
 *
 * Example:
 *   GET /api/lighthouse/api/parties/canquest-validator-1::123/tx?limit=15
 *   → GET https://api-canton.interscan.pro/mainnet/api/parties/canquest-validator-1::123/tx?limit=15
 */
const LIGHTHOUSE_BASE =
  process.env.LIGHTHOUSE_API_URL ??
  "https://api-canton.interscan.pro/mainnet";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const joinedPath = path.join("/");
  const search = request.nextUrl.search;
  const url = `${LIGHTHOUSE_BASE}/${joinedPath}${search}`;

  try {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
      next: { revalidate: 0 },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: "Lighthouse proxy error", detail: String(err) },
      { status: 502 },
    );
  }
}
