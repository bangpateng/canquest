/**
 * Backup database Supabase (panggilan pg_dump via subprocess).
 *
 * Free tier Supabase TIDAK punya backup otomatis. Script ini wajib di-schedule
 * (cron / systemd timer) supaya ada rollback point kalau ada data corruption.
 *
 * Cara kerja:
 *  - Panggil `pg_dump` (harus terinstall di host) terhadap DATABASE_URL.
 *  - Simpan file .dump (custom format) di direktori output, retensi N hari.
 *  - Hapus backup lebih tua dari retention (default 14 hari).
 *
 * Schedule rekomendasi (jalankan di VPS yang sama dengan API, atau server manapun
 * yang bisa reach Supabase DB):
 *
 *   crontab -e
 *   # Backup harian jam 03:00 pagi (saat traffic terendah)
 *   0 3 * * * /usr/bin/node /path/to/can/apps/api/scripts/backup-supabase.cjs \
 *     >> /var/log/supabase-backup.log 2>&1
 *
 * Atau systemd timer (lebih robust — ada retry + logging).
 *
 * Prasyarat:
 *  - pg_dump v15+ terinstall (`sudo apt install postgresql-client-15`).
 *  - DATABASE_URL di env (boleh direct connection Supabase, port 5432).
 *  - BACKUP_OUTPUT_DIR (default: ./backups).
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node backup-supabase.cjs
 *   BACKUP_OUTPUT_DIR=/var/backups/canquest BACKUP_RETENTION_DAYS=30 node backup-supabase.cjs
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const OUTPUT_DIR = process.env.BACKUP_OUTPUT_DIR ?? path.resolve(__dirname, '..', 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 14);

if (!DATABASE_URL) {
  console.error('[backup] FATAL: DATABASE_URL belum diset di env.');
  process.exit(1);
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function rotateOldBackups(dir) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.dump')) continue;
    const full = path.join(dir, entry);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch {
      // ignore files yang tidak bisa di-stat
    }
  }
  return removed;
}

function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const fileName = `canquest-supabase-${timestamp()}.dump`;
  const fullPath = path.join(OUTPUT_DIR, fileName);
  const start = Date.now();

  console.log(`[backup] mulai → ${fullPath}`);

  try {
    // pg_dump custom format: kompresi built-in, support selective restore.
    execFileSync(
      'pg_dump',
      [
        DATABASE_URL,
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        `--file=${fullPath}`,
      ],
      { stdio: 'inherit', timeout: 30 * 60 * 1000 }, // max 30 menit
    );
  } catch (err) {
    console.error('[backup] GAGAL:', err.message);
    // Hapus file parsial kalau ada.
    try {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch {
      /* ignore */
    }
    process.exit(1);
  }

  const sizeMb = (fs.statSync(fullPath).size / (1024 * 1024)).toFixed(2);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[backup] SELESAI: ${sizeMb} MB dalam ${elapsed}s`);

  const removed = rotateOldBackups(OUTPUT_DIR);
  if (removed > 0) {
    console.log(`[backup] rotasi: hapus ${removed} backup lama (> ${RETENTION_DAYS} hari).`);
  }

  // SARAN: untuk retensi off-site, sync ke R2/S3 setelah ini (script terpisah).
  console.log(
    '[backup] TIPS: untuk retensi off-site, upload file ke R2/S3 terpisah ' +
      '(free egress di R2) supaya backup selamat walau VPS bermasalah.',
  );
}

main();
