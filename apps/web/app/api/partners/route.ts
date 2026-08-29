import { type NextRequest } from "next/server";
import { nestWithAccessCookie } from "@/lib/auth/nest-proxy-cookie-jwt";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const q = searchParams.get("q");
  const qs = new URLSearchParams();
  if (category) qs.set("category", category);
  if (q) qs.set("q", q);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return nestWithAccessCookie(req, `/partners${suffix}`, { method: "GET" });
}
