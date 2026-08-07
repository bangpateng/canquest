#!/usr/bin/env node
/**
 * Backup harian database Postgres lokal VPS 2 (canquest_prod) → Cloudflare R2.
 *
 * Pengganti auto-backup Supabase (yang dulu gratis). Sekarang database production
 * 100% di VPS 2, jadi backup otomatis jadi TANGGUNG JAWAB VPS — script ini wajib
 * di-schedule via cron.
 *
 * ALUR:
 *   1. pg_dump canquest_prod (custom format, kompresi otomatis via -Fc)
 *   2. Upload ke R2 (key: backups/postgres/YYYY-MM-DD_HHMM.dump)
 *   3. Retention: hapus backup R2 lebih tua dari BACKUP_RETENTION_DAYS
 *   4. Simpan 1 copy on-site (VPS disk) untuk restore cepat
 *
 * ENV (baca dari apps/api/.env atau shell):
 *   DATABASE_URL          — wajib (canquest_prod connection string)
 *   R2_ACCOUNT_ID         — wajib
 *   R2_ACCESS_KEY_ID      — wajib
 *   R2_SECRET_ACCESS_KEY  — wajib
 *   R2_BUCKET_NAME        — wajib (bucket yang sama dgn media, atau bucket khusus backup)
 *   R2_ENDPOINT           — opsional (default: https://<ACCOUNT_ID>.r2.cloudflarestorage.com)
 *   BACKUP_R2_PREFIX      — opsional (default: backups/postgres/)
 *   BACKUP_LOCAL_DIR      — opsional (default: /var/backups/canquest)
 *   BACKUP_RETENTION_DAYS — opsional (default: 30)
 *   BACKUP_LOCAL_KEEP     — opsional (default: 7, copy on-site di VPS)
 *
 * USAGE:
 *   node scripts/backup-postgres-r2.cjs
 *
 * CRON (jalankan tiap hari jam 3 pagi — traffic rendah):
 *   0 3 * * * /usr/bin/node /var/www/canquest/scripts/backup-postgres-r2.cjs \
 *     >> /var/log/canquest-backup.log 2>&1
 *
 * RESTORE (lihat docs/BACKUP_RESTORE.md):
 *   pg_restore -d <DB_URL> --no-owner --no-privileges <file>.dump
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

// ── Load apps/api/.env (cron tidak mewarisi env shell interaktif) ─────────────
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
const REPO_ROOT = path.resolve(__dirname, '..');
loadEnvFile(path.join(REPO_ROOT, 'apps/api/.env'));

// ── Config ───────────────────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID?.trim();
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID?.trim();
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY?.trim();
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME?.trim();
const R2_ENDPOINT =
  process.env.R2_ENDPOINT?.trim() ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
const R2_PREFIX = (process.env.BACKUP_R2_PREFIX || 'backups/postgres/').trim();
const LOCAL_DIR = process.env.BACKUP_LOCAL_DIR || '/var/backups/canquest';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
const LOCAL_KEEP = parseInt(process.env.BACKUP_LOCAL_KEEP || '7', 10);

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const err = (...a) => console.error(`[${new Date().toISOString()}] ERROR:`, ...a);

// ── Validate ─────────────────────────────────────────────────────────────────
function die(msg) {
  err(msg);
  process.exit(1);
}
if (!DATABASE_URL) die('DATABASE_URL missing (set in apps/api/.env)');
if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_ENDPOINT) {
  die('R2 config missing — butuh R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, (R2_ACCOUNT_ID|R2_ENDPOINT)');
}

// ── Find pg_dump (prefer highest version; DB lokal mungkin 16, dump tetap aman) ─
function findPgDump() {
  // Cari di /usr/lib/postgresql/*/bin/pg_dump (versi tertinggi dulu), fallback PATH
  const dirs = [];
  try {
    const libDirs = execFileSync('ls', ['-d', '/usr/lib/postgresql/*/bin'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .filter(Boolean)
      .sort()
      .reverse();
    for (const d of libDirs) {
      const candidate = path.join(d, 'pg_dump');
      if (fs.existsSync(candidate)) dirs.push(candidate);
    }
  } catch {
    /* non-linux atau ls gagal */
  }
  dirs.push('pg_dump'); // fallback ke PATH
  return dirs[0];
}

const PGDUMP = findPgDump();

// ── Step 1: pg_dump ──────────────────────────────────────────────────────────
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(
    d.getHours(),
  )}${p(d.getMinutes())}`;
}

async function main() {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  const fileName = `canquest_prod_${timestamp()}.dump`;
  const localPath = path.join(LOCAL_DIR, fileName);

  log(`pg_dump: ${PGDUMP}`);
  log(`Dumping canquest_prod → ${localPath}`);
  execFileSync(
    PGDUMP,
    [DATABASE_URL, '-Fc', '--no-owner', '--no-privileges', '--no-comments', '-f', localPath],
    { stdio: 'inherit' },
  );

  const sizeMB = (fs.statSync(localPath).size / 1024 / 1024).toFixed(2);
  log(`✓ Dump saved: ${fileName} (${sizeMB} MB)`);

  // ── Step 2: upload to R2 ───────────────────────────────────────────────────
  const client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    forcePathStyle: true,
  });
  const r2Key = `${R2_PREFIX}${fileName}`;
  const body = fs.readFileSync(localPath);

  log(`Uploading → R2 s3://${R2_BUCKET_NAME}/${r2Key}`);
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: r2Key,
      Body: body,
      ContentType: 'application/octet-stream',
      Metadata: { 'db-name': 'canquest_prod', source: 'auto-backup' },
    }),
  );
  log(`✓ Uploaded to R2`);

  // ── Step 3: R2 retention (delete old backups) ──────────────────────────────
  const listRes = await client.send(
    new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix: R2_PREFIX }),
  );
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  const toDelete = (listRes.Contents || [])
    .filter((o) => o.LastModified && o.LastModified.getTime() < cutoff)
    .map((o) => ({ Key: o.Key }));
  if (toDelete.length > 0) {
    log(`R2 retention: deleting ${toDelete.length} backup(s) older than ${RETENTION_DAYS} days`);
    await client.send(
      new DeleteObjectsCommand({ Bucket: R2_BUCKET_NAME, Delete: { Objects: toDelete } }),
    );
  } else {
    log(`R2 retention: no old backups to delete (cutoff ${RETENTION_DAYS} days)`);
  }

  // ── Step 4: local retention (keep N recent copies on-site) ─────────────────
  const localFiles = fs
    .readdirSync(LOCAL_DIR)
    .filter((f) => f.startsWith('canquest_prod_') && f.endsWith('.dump'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(LOCAL_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const stale = localFiles.slice(LOCAL_KEEP);
  for (const { f } of stale) {
    fs.unlinkSync(path.join(LOCAL_DIR, f));
  }
  if (stale.length > 0) {
    log(`Local retention: removed ${stale.length} old local backup(s) (keep ${LOCAL_KEEP})`);
  }

  log(`✓ Backup complete: ${fileName} (R2 + local on-site)`);
}

main().catch((e) => {
  err(e?.message || String(e));
  if (e?.$metadata) err('AWS metadata:', JSON.stringify(e.$metadata));
  process.exit(1);
});
