import { type NextRequest } from "next/server";
import { nestWithAdminAccessCookie } from "@/lib/auth/nest-proxy-admin-access";

// NOTE: route path `/admin/earn-hub/ensure` dipertahankan utk kompatibilitas BE.
// Menu UI-nya = menu QUEST. Lihat docs/EARN_FLOW_CURRENT.md.
export async function POST(req: NextRequest) {
  return nestWithAdminAccessCookie(req, "/admin/earn-hub/ensure", { method: "POST" });
}
