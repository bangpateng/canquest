import { type NextRequest } from "next/server";
import { nestWithAdminAccessCookie } from "@/lib/nest-proxy-admin-access";

type P = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: P) {
  const { id } = await params;
  return nestWithAdminAccessCookie(req, `/admin/wallet-invites/${id}`, { method: "DELETE" });
}
