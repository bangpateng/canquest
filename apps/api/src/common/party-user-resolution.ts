import { normalizeCantonPartyId } from './canton-party-id';

/** Hasil resolusi party → user. */
export interface ResolvedPartyUser {
  userId: string;
  username: string | null;
}

/**
 * Subset delegat Prisma `user` yang dibutuhkan resolver — dipakai supaya unit
 * test bisa mock tanpa bootstrapping PrismaService.
 */
export interface PartyUserLookup {
  findMany(args: {
    where: { cantonPartyId: { equals: string; mode: 'insensitive' } };
    select: { id: true; username: true };
    take: number;
  }): Promise<Array<{ id: string; username: string | null }>>;
}

/**
 * Resolver party → user KETAT (Phase 4 L1, menutup gap #19 Phase 2).
 *
 * SATU-SATUNYA cara mencocokkan: `User.cantonPartyId` == partyId secara eksak
 * (full string, case-insensitive — konvensi `normalizeCantonPartyId`). Ini adalah
 * pemetaan eksplisit party_id → user_id yang tersimpan di DB, bukan tebakan.
 *
 * Yang SENGAJA dibuang dibanding resolver lama di BalanceEventHandler:
 *   - kecocokan prefix username (`karel::1220…` → user ber-username `karel`),
 *   - kecocokan `keycloakId` (exact maupun `contains` untuk party `auth0_…`),
 *   - semua bentuk fallback lain.
 * Heuristik lama bisa menempel baris history ke user yang salah (dan membocorkan
 * aktivitas antar-user) saat satu username menjadi prefix username/party lain.
 *
 * Party internal aplikasi (prefix `canquest:`) dan party tak dikenal → null
 * (bukan error — sistem wallet DSO/validator/Cantex memang bukan user dapp).
 *
 * Fail-closed: bila >1 baris user match case-insensitive (tabrakan casing —
 * unique constraint DB hanya case-sensitive), kembalikan null. Menolak satu
 * event lebih aman daripada menebak pemiliknya; skrip audit
 * scripts/audit-party-resolution.cjs memastikan kondisi ini tidak pernah
 * terjadi di data nyata.
 */
export async function findUserByPartyExact(
  users: PartyUserLookup,
  partyId: string | null | undefined,
): Promise<ResolvedPartyUser | null> {
  const normalized = normalizeCantonPartyId(partyId);
  if (!normalized) return null;
  // Namespace internal dapp — tidak pernah dimiliki User.
  if (normalized.startsWith('canquest:')) return null;

  const rows = await users.findMany({
    where: { cantonPartyId: { equals: normalized, mode: 'insensitive' } },
    select: { id: true, username: true },
    take: 2,
  });
  if (rows.length !== 1) return null; // 0 = tak dikenal; >1 = tabrakan casing → tolak
  return { userId: rows[0].id, username: rows[0].username };
}
