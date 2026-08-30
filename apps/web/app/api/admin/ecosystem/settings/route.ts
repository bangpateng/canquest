import { type NextRequest } from "next/server";
import { nestWithAdminAccessCookie } from "@/lib/auth/nest-proxy-admin-access";

export async function GET(req: NextRequest) {
  return nestWithAdminAccessCookie(req, "/admin/ecosystem/settings", {
    method: "GET",
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.text();
  return nestWithAdminAccessCookie(req, "/admin/ecosystem/settings", {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/json" },
  });
}
