import { nestWithAccessCookie } from "@/lib/auth/nest-proxy-cookie-jwt";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, "/party/wallet-access", { method: "GET" });
}
