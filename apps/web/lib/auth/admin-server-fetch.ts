import { cookies } from "next/headers";

import { CQ_ADMIN_ACCESS_COOKIE } from "@/lib/auth/auth-cookies";
import { internalApiBase } from "@/lib/api/internal-api-url";

/**
 * Server-side (RSC) fetch ke Nest `/admin/**` dengan cookie admin.
 *
 * INTERNAL_API_URL produksi mengarah ke api.canquest.cc lewat nginx, dan nginx
 * MENOLAK /api/admin/* dari internet tanpa header x-admin-bff-secret (shared
 * secret, map $http_x_admin_bff_secret). Tanpa header ini semua halaman admin
 * server-side mendapat 403 → data kosong (bug "jumlah user tidak muncul").
 * Mirror pola nestWithAdminAccessCookie (BFF route handlers).
 */
export async function adminServerFetch<T>(
  path: string,
): Promise<T | null> {
  const jar = await cookies();
  const token = jar.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  if (!token) return null;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const adminBffSecret = process.env.ADMIN_BFF_SECRET?.trim();
  if (adminBffSecret) headers["x-admin-bff-secret"] = adminBffSecret;

  try {
    const res = await fetch(`${internalApiBase()}/admin${path}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
