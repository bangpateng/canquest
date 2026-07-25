import { type NextRequest } from "next/server";
import { nestWithAdminAccessCookie } from "@/lib/auth/nest-proxy-admin-access";

// NOTE: route path `/admin/earn-hub` dipertaharkan utk kompatibilitas BE.
// Menu UI-nya = menu QUEST (QuestKind.EARN_HUB). Lihat docs/EARN_FLOW_CURRENT.md.
export async function GET(req: NextRequest) {
  return nestWithAdminAccessCookie(req, "/admin/earn-hub", { method: "GET" });
}
