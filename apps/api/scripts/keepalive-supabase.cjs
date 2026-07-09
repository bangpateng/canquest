/**
 * Keep-alive ping untuk mencegah auto-pause Free tier Supabase.
 *
 * Free tier Supabase akan PAUSE project setelah 7 hari tanpa aktivitas API.
 * Project yang paused akan cold-start ~30-60 detik saat request pertama datang
 * (user mengalami error/timeout). Script ini mencegah pause dengan meng-query
 * DB secara berkala.
 *
 * Dua mode:
 *  1. Run sekali (untuk dipanggil cron eksternal — UptimeRobot/cron-job.org):
 *       node keepalive-supabase.cjs
 *     Schedule: setiap 6 jam. Cron eksternal gratis lebih reliable daripada
 *     setTimeout di proses lain.
 *
 *  2. Run loop (self-contained, untuk systemd service):
 *       KEEPALIVE_LOOP=1 node keepalive-supabase.cjs
 *     Loop internal tiap KEEPALIVE_INTERVAL_MS (default 6 jam).
 *
 * Yang diping: query ringan `SELECT 1` via Prisma ke DATABASE_URL Supabase.
 * Ini hit API Supabase (yang menghitung sebagai "activity") + pastikan koneksi
 * DB sehat.
 *
 * Schedule cron di VPS:
 *   crontab -e
 *   # Ping tiap 6 jam (00:00, 06:00, 12:00, 18:00)
 *   0 */6 * * * /usr/bin/node /path/to/can/apps/api/scripts/keepalive-supabase.cjs \
 *     >> /var/log/supabase-keepalive.log 2>&1
 *
 * Atau pakai monitor eksternal gratis (UptimeRobot / cron-job.org / BetterStack):
 *   - Buat HTTP monitor → URL: https://canquest.cc/api/health/db
 *   - Interval: 5 menit (gratis di UptimeRobot)
 *   - Ini lebih baik: 2 manfaat sekaligus (keep-alive + uptime monitoring)
 *     Tanpa perlu script ini.
 *
 * Prasyarat: DATABASE_URL di env (Supabase direct/pooler connection).
 */
const { PrismaClient } = require('@prisma/client');

const LOOP = process.env.KEEPALIVE_LOOP === '1';
const INTERVAL_MS = Number(process.env.KEEPALIVE_INTERVAL_MS ?? 6 * 60 * 60 * 1000);

async function pingOnce() {
  const prisma = new PrismaClient();
  const start = Date.now();
  try {
    // Query ringan — cukup hit API Supabase supaya dianggap "active".
    await prisma.$queryRaw`SELECT 1`;
    const ms = Date.now() - start;
    console.log(
      `[keepalive] ${new Date().toISOString()} OK (${ms}ms) — DB aktif, auto-pause di-reset.`,
    );
  } catch (err) {
    console.error(
      `[keepalive] ${new Date().toISOString()} GAGAL: ${err.message}`,
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

async function loop() {
  console.log(`[keepalive] mode LOOP aktif, interval = ${INTERVAL_MS / 1000}s.`);
  // Jalankan langsung, lalu tiap interval.
  await pingOnce();
  setInterval(pingOnce, INTERVAL_MS);
}

if (LOOP) {
  loop();
} else {
  pingOnce();
}
