import { type NextRequest } from "next/server";
import { nestWithAdminAccessCookie } from "@/lib/auth/nest-proxy-admin-access";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ partnerId: string }> },
) {
  const { partnerId } = await params;
  const body = await req.text();
  return nestWithAdminAccessCookie(
    req,
    `/admin/partners/${encodeURIComponent(partnerId)}`,
    { method: "PATCH", body, headers: { "Content-Type": "application/json" } },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ partnerId: string }> },
) {
  const { partnerId } = await params;
  return nestWithAdminAccessCookie(
    req,
    `/admin/partners/${encodeURIComponent(partnerId)}`,
    { method: "DELETE" },
  );
}
