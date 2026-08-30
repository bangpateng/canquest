import { type NextRequest } from "next/server";
import { nestWithAdminAccessCookie } from "@/lib/auth/nest-proxy-admin-access";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.text();
  return nestWithAdminAccessCookie(
    req,
    `/admin/ecosystem/categories/${encodeURIComponent(id)}`,
    { method: "PATCH", body, headers: { "Content-Type": "application/json" } },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nestWithAdminAccessCookie(
    req,
    `/admin/ecosystem/categories/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
