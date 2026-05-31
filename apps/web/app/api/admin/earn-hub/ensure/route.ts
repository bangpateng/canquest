import { type NextRequest } from "next/server";
import { nestWithAdminAccessCookie } from "@/lib/auth/nest-proxy-admin-access";

export async function POST(req: NextRequest) {
  return nestWithAdminAccessCookie(req, "/admin/earn-hub/ensure", { method: "POST" });
}
