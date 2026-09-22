import { type NextRequest } from "next/server";
import { nestWithAdminAccessCookie } from "@/lib/auth/nest-proxy-admin-access";

// NOTE: route path `/admin/earn-hub/ensure` kept for backend compatibility.
// The UI menu for it is the QUEST menu. See docs/EARN_FLOW_CURRENT.md.
export async function POST(req: NextRequest) {
  return nestWithAdminAccessCookie(req, "/admin/earn-hub/ensure", { method: "POST" });
}
