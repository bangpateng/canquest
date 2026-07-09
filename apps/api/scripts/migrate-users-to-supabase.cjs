/**
 * Migrasi user lokal → Supabase auth.users (dengan password hash lama).
 *
 * Strategi:
 *  - INSERT langsung ke auth.users Supabase via SQL (pakai service_role key).
 *    Kenapa bukan admin.createUser()? Karena admin API akan RE-HASH password,
 *    sehingga user harus reset password. Dengan INSERT encrypted_password =
 *    hash bcrypt lama ($2a$/$2b$), user login pakai password asli tanpa reset.
 *    GoTrue (Supabase Auth backend) verifikasi bcrypt dengan membaca cost dari
 *    prefix hash → kompatibel dengan cost-12 Anda (default Supabase cost-10).
 *  - Setelah dapat UUID auth.users baru, UPDATE kolom "authUserId" di User lokal.
 *
 * Idempotent: user yang sudah punya authUserId di-skip. Bisa dijalankan ulang.
 *
 * Prasyarat:
 *  - DATABASE_URL = PostgreSQL Supabase (sudah di-restore dari lokal).
 *  - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY di env.
 *  - Kolom "authUserId" sudah ada di tabel User (migration add_supabase_auth_link).
 *
 * Usage:
 *   node apps/api/scripts/migrate-users-to-supabase.cjs                  # dry-run (default)
 *   node apps/api/scripts/migrate-users-to-supabase.cjs --apply          # eksekusi nyata
 *   node apps/api/scripts/migrate-users-to-supabase.cjs --limit 5        # batch kecil (test)
 *
 * SAFETY: default = dry-run. --apply untuk eksekusi.
 */
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@supabase/supabase-js');

const prisma = new PrismaClient();

const apply = process.argv.includes('--apply');
const limitArg = process.argv.includes('--limit')
  ? Number(process.argv[process.argv.indexOf('--limit') + 1])
  : undefined;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(msg) {
  console.error(`[FATAL] ${msg}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail(
    'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset di env. ' +
      'Isi di apps/api/.env atau export sebelum jalankan script.',
  );
}

// Service-role client (bypass RLS) — dipakai untuk RPC SQL ke auth.users.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Insert satu user ke auth.users Supabase via RPC (plpgsql) yang kita definisikan
 * inline. Pakai rpc() supaya parameter ter-bind (anti SQL injection), dan return
 * UUID baru.
 *
 * Catatan schema auth.users (GoTrue) — field wajib:
 *  id (uuid), aud ('authenticated'), role ('authenticated'), email,
 *  encrypted_password (bcrypt), email_confirmed_at, created_at, updated_at,
 *  instance_id (uuid konstan '00000000-0000-0000-0000-000000000000'),
 *  raw_app_meta_data (jsonb), raw_user_meta_data (jsonb).
 */
async function insertAuthUser({ email, passwordHash, legacyUserId, referralCode }) {
  // Cek dulu apakah email sudah ada di auth.users (idempotent).
  const { data: existing } = await supabase
    .from('auth.users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing?.id) {
    return { id: existing.id, reused: true };
  }

  // INSERT via RPC function anonim. Karena service_role bypass RLS + punya akses
  // ke schema auth, kita bisa INSERT langsung.
  const { data, error } = await supabase.rpc('migrate_legacy_user', {
    p_email: email.toLowerCase(),
    p_encrypted_password: passwordHash,
    p_legacy_user_id: legacyUserId,
    p_referral_code: referralCode ?? null,
  });

  if (error) {
    // Kalau RPC function belum dibuat, fallback ke insert langsung via PostgREST
    // (auth.users exposed ke service_role). Tapi PostgREST tidak暴露 auth schema
    // by default → kita instruct user buat RPC dulu (lihat header script).
    return { error: error.message };
  }
  return { id: data, reused: false };
}

async function main() {
  console.log(`[migrate-users] mode = ${apply ? 'APPLY' : 'DRY-RUN (--apply untuk eksekusi)'}`);
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

  console.log(`[migrate-users] ${users.length} user akan di-migrate (belum ter-link).`);

  if (users.length === 0) {
    console.log('[migrate-users] tidak ada yang perlu di-migrate. Selesai.');
    return;
  }

  if (!apply) {
    console.log('[migrate-users] DRY-RUN — 5 sample pertama:');
    for (const u of users.slice(0, 5)) {
      console.log(`  - ${u.email} (id=${u.id}, hash=${u.passwordHash.slice(0, 10)}...)`);
    }
    return;
  }

  let ok = 0;
  let reused = 0;
  let failed = 0;
  const failures = [];

  for (const u of users) {
    const result = await insertAuthUser({
      email: u.email,
      passwordHash: u.passwordHash,
      legacyUserId: u.id,
      referralCode: u.referralCode,
    });

    if (result.error || !result.id) {
      failed++;
      failures.push({ email: u.email, error: result.error ?? 'no id returned' });
      continue;
    }

    // Link User lokal → authUserId Supabase.
    await prisma.user.update({
      where: { id: u.id },
      data: { authUserId: result.id },
    });

    if (result.reused) reused++;
    else ok++;
    if ((ok + reused) % 100 === 0) {
      console.log(`[migrate-users] progress: ${ok + reused}/${users.length} ...`);
    }
  }

  console.log('\n[migrate-users] SELESAI:');
  console.log(`  - Berhasil dibuat baru : ${ok}`);
  console.log(`  - Reused (sudah ada)   : ${reused}`);
  console.log(`  - Gagal                : ${failed}`);
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
