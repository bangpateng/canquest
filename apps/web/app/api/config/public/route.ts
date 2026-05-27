import { NextResponse } from 'next/server';
import { getCcRewardLogoUrl } from '@/lib/cc-reward-logo';

export const dynamic = 'force-dynamic';

/** Runtime public config (avoids rebuild when only server .env changes on VPS). */
export async function GET() {
  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ||
    process.env.TURNSTILE_SITE_KEY?.trim() ||
    process.env.CF_TURNSTILE_SITE_KEY?.trim() ||
    '';

  return NextResponse.json({
    turnstileSiteKey,
    ccRewardLogoUrl: getCcRewardLogoUrl(),
  });
}
