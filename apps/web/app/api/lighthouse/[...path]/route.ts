import { type NextRequest, NextResponse } from "next/server";

/**
 * Lighthouse Explorer API proxy.
 *
 * Proxies GET requests from the browser to the Lighthouse Explorer API to
 * avoid CORS issues. Path segments are encoded and the final URL is
 * validated to stay under the configured origin to prevent SSRF / open-proxy
 * behavior if LIGHTHOUSE_API_URL is ever misconfigured.
 *
 * Example:
 *   GET /api/lighthouse/api/parties/canquest-validator-1::123/tx?limit=15
 *   → GET https://api-canton.interscan.pro/mainnet/api/parties/canquest-validator-1::123/tx?limit=15
 */
const LIGHTHOUSE_BASE = (
  process.env.LIGHTHOUSE_API_URL ??
  "https://api-canton.interscan.pro/mainnet"
).replace(/\/$/, "");

// Pre-parse the allowed origin once so every request can be checked against it.
const ALLOWED_ORIGIN = (() => {
  try {
    return new URL(LIGHTHOUSE_BASE).origin;
  } catch {
    return null;
  }
})();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  // Encode each segment to prevent `&`/`=`/`#` injection into the upstream URL.
  const joinedPath = path.map((seg) => encodeURIComponent(seg)).join("/");
  const search = request.nextUrl.search;

  if (!ALLOWED_ORIGIN) {
    return NextResponse.json(
      { error: "Lighthouse proxy misconfigured" },
      { status: 502 },
    );
  }

  let url: URL;
  try {
    url = new URL(`/${joinedPath}${search}`, ALLOWED_ORIGIN);
  } catch {
    return NextResponse.json(
      { error: "Invalid request path" },
      { status: 400 },
    );
  }

  // Defense against open-proxy / SSRF: the final resolved URL MUST stay on the
  // allowed origin (an attacker cannot redirect to an internal host).
  if (url.origin !== ALLOWED_ORIGIN) {
    return NextResponse.json(
      { error: "Request not allowed" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    // Sanitize: leak only the message, never internal topology / stack.
    const message =
      err instanceof Error ? err.message : "Upstream request failed";
    return NextResponse.json(
      { error: "Lighthouse proxy error", message },
      { status: 502 },
    );
  }
}
