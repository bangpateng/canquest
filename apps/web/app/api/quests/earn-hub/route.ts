import { type NextRequest } from "next/server";
import { nestWithAccessCookie } from "@/lib/auth/nest-proxy-cookie-jwt";

// NOTE: route path `/quests/earn-hub` dipertahankan utk kompatibilitas BE
// (NestJS controller + enum QuestKind.EARN_HUB). Menu UI-nya = menu QUEST.
// Identifier FE sudah pakai "questHub"; lihat docs/EARN_FLOW_CURRENT.md.
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, "/quests/earn-hub", { method: "GET" });
}
