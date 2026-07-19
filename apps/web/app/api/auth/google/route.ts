import { setAuthCookies } from "@/lib/auth/auth-cookies";
import { postJsonParse } from "@/lib/api/internal-api-url";
import { NextResponse } from "next/server";

/**
 * Google Login BFF — forward Google ID Token ke Nest /auth/google, set cookie
 * cq_access/cq_refresh kalau backend issue JWT CanQuest.
 *
 * Tidak butuh Turnstile (Google verify signature sendiri). Throttle backend
 * sudah handle 10 req/menit per IP.
 *
 * Body: { idToken, referralCode? } — referralCode opsional. Frontend kirim
 * dari sessionStorage `canquest_referral_ref` (link ?ref= atau input manual).
 */
export async function POST(req: Request) {
  let body: { idToken?: string; referralCode?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const idToken = body.idToken?.trim();
  if (!idToken) {
    return NextResponse.json({ message: "Missing Google ID token" }, { status: 400 });
  }

  const referralCode = body.referralCode?.trim() || undefined;

  const { res, data } = await postJsonParse<Record<string, unknown>>(
    "/auth/google",
    referralCode ? { idToken, referralCode } : { idToken },
  );
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const out = NextResponse.json({ ok: true });
  if (
    typeof data.accessToken === "string" &&
    typeof data.refreshToken === "string"
  ) {
    setAuthCookies(out, data.accessToken, data.refreshToken);
    return out;
  }

  // Backend tidak kirim token — anggap gagal (502 supaya frontend tampilkan error).
  return NextResponse.json(
    {
      message:
        "Google login failed: backend did not issue session tokens.",
    },
    { status: 502 },
  );
}
