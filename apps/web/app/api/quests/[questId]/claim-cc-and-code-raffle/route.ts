import { type NextRequest } from "next/server";
import { nestWithAccessCookie } from "@/lib/auth/nest-proxy-cookie-jwt";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  return nestWithAccessCookie(
    req,
    `/quests/${questId}/claim-cc-and-code-raffle`,
    { method: "POST" },
    { upstreamTimeoutMs: 60_000 },
  );
}
