import { type NextRequest } from "next/server";
import { nestWithAccessCookie } from "@/lib/auth/nest-proxy-cookie-jwt";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nestWithAccessCookie(req, `/partners/${encodeURIComponent(id)}`, {
    method: "GET",
  });
}
