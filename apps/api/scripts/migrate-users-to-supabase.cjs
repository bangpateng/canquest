/**
 * Migrasi user lokal → Supabase auth.users (dengan password hash lama).
 *
 * Strategi:
 *  - Baca user dari tabel User (yang sudah di-restore ke DB Supabase).
 *  - Panggil RPC function `migrate_legacy_user(...)` via SQL langsung (Prisma
 *    $queryRaw). Function itu INSERT ke auth.users dengan encrypted_password =
 *    hash bcrypt lama → user login pakai password asli TANPA reset.
 *  - Setelah dapat UUID, UPDATE kolom "authUserId" di User lokal.
 *
 * Kenapa pakai SQL langsung, bukan supabase-js?
 *  - @supabase/supabase-js versi terbaru butuh Node 22+ (native WebSocket).
 *    VPS pakai Node 20 → createClient() crash. SQL langsung lewat Prisma tidak
 *    butuh WebSocket sama sekali, jalan di Node 20.
 *  - DATABASE_URL connect sebagai role `postgres` (superuser) → bisa panggil
 *    function public.migrate_legacy_user yang `security definer`.
 *
 * Idempotent: user yang sudah punya authUserId di-skip. Bisa dijalankan ulang.
 *
 * Prasyarat:
 *  - DATABASE_URL = PostgreSQL Supabase (role postgres, direct connection).
 *  - Function migrate_legacy_user sudah dibuat (lihat SQL di repo).
 *  - Kolom "authUserId" sudah ada di tabel User.
 *
 * Usage:
 *   node apps/api/scripts/migrate-users-to-supabase.cjs                  # dry-run
 *   node apps/api/scripts/migrate-users-to-supabase.cjs --apply          # eksekusi
 *   node apps/api/scripts/migrate-users-to-supabase.cjs --apply --limit 5
 *
 * SAFETY: default = dry-run. --apply untuk eksekusi.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const apply = process.argv.includes('--apply');
const limitArg = process.argv.includes('--limit')
  ? Number(process.argv[process.argv.indexOf('--limit') + 1])
  : undefined;

/**
 * Panggil RPC migrate_legacy_user via SQL langsung.
 * Return UUID baru (atau UUID existing kalau email sudah ada), atau throw.
 */
async function insertAuthUser({ email, passwordHash, legacyUserId, referralCode }) {
  const rows = await prisma.$queryRaw`
    SELECT migrate_legacy_user(
      ${email}::text,
      ${passwordHash}::text,
      ${legacyUserId}::text,
      ${referralCode}::text
    ) AS auth_id
  `;
  // $queryRaw return array of objects; bigint/string UUID di kolom auth_id.
  const row = rows[0];
  return String(row.auth_id);
}

async function main() {
  console.log(
    `[migrate-users] mode = ${apply ? 'APPLY' : 'DRY-RUN (--apply untuk eksekusi)'}`,
  );
  if (limitArg) console.log(`[migrate-users] limit = ${limitArg}`);

  const where = {
    emailVerified: true,
    passwordHash: { not: null },
    authUserId: null,
  };
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      passwordHash: true,
      referralCode: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
    ...(limitArg ? { take: limitArg } : {}),
  });

  console.log(
    `[migrate-users] ${users.length} user akan di-migrate (emailVerified & belum ter-link).`,
  );

  if (users.length === 0) {
    console.log('[migrate-users] tidak ada yang perlu di-migrate. Selesai.');
    return;
  }

  if (!apply) {
    console.log('[migrate-users] DRY-RUN — 5 sample pertama:');
    for (const u of users.slice(0, 5)) {
      const hashPrefix = u.passwordHash.slice(0, 10);
      const hashType = u.passwordHash.startsWith('$2a$')
        ? '$2a$'
        : u.passwordHash.startsWith('$2b$')
          ? '$2b$'
          : u.passwordHash.startsWith('$2y$')
            ? '$2y$'
            : 'UNKNOWN';
      console.log(
        `  - ${u.email} (id=${u.id.slice(0, 12)}..., hash=${hashPrefix}... [${hashType}])`,
      );
    }
    // Statistik format hash (penting: semua harus $2a$/$2b$/$2y$ = bcrypt).
    const byType = {};
    for (const u of users) {
      const t = u.passwordHash.slice(0, 4);
      byType[t] = (byType[t] ?? 0) + 1;
    }
    console.log('[migrate-users] distribusi format hash:');
    for (const [t, c] of Object.entries(byType)) {
      console.log(`    ${t} : ${c}`);
    }
    return;
  }

  let ok = 0;
  let reused = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    try {
      const authId = await insertAuthUser({
        email: u.email,
        passwordHash: u.passwordHash,
        legacyUserId: u.id,
        referralCode: u.referralCode,
      });

      // Cek apakah ini reused (sudah ada sebelumnya) — tidak bisa tau persis
      // tanpa query tambahan, anggap baru semua kecuali kalau authUserId sudah
      // set. Untuk akurasi, query apakah user ini sebelumnya sudah punya row
      // auth identity. Tapi untuk laporan, hitung berdasarkan sukses.
      await prisma.user.update({
        where: { id: u.id },
        data: { authUserId: authId },
      });
      ok++;
      if (ok % 100 === 0) {
        console.log(
          `[migrate-users] progress: ${i + 1}/${users.length} (ok=${ok}) ...`,
        );
      }
    } catch (err) {
      failed++;
      failures.push({ email: u.email, error: err.message });
    }
  }

  console.log('\n[migrate-users] SELESAI:');
  console.log(`  - Berhasil        : ${ok}`);
  console.log(`  - Gagal           : ${failed}`);
  if (failures.length) {
    console.log('\n[migrate-users] DETAIL KEGAGALAN (5 pertama):');
    for (const f of failures.slice(0, 5)) {
      console.log(`  - ${f.email}: ${f.error}`);
    }
  }
}

main()
  .catch((err) => {
    console.error('[migrate-users] ERROR:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
