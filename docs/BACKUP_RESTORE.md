# Backup & Restore — Postgres VPS 2 (`canquest_prod`)

> Setelah migrasi dari Supabase, database production 100% di VPS 2. Supabase dulu
> punya auto-backup gratis — sekarang tanggung jawab itu pindah ke VPS. **Tanpa
> backup aktif, satu kerusakan disk = kehilangan semua user.**
>
> **Script:** [`scripts/backup-postgres-r2.cjs`](../scripts/backup-postgres-r2.cjs)

## Strategi backup

| Aspek | Nilai |
|-------|-------|
| Format | `pg_dump -Fc` (custom, terkompresi) |
| Frekuensi | Harian (cron jam 3 pagi) |
| Penyimpanan 1 | **R2** (off-site, tahan kalau VPS hilang) — retention 30 hari |
| Penyimpanan 2 | **Disk VPS** `/var/backups/canquest` (restore cepat) — keep 7 copy |
| Yang dibackup | `canquest_prod` (schema public + data + `_prisma_migrations`) |

R2 dipilih karena sudah terkonfigurasi di app (pakai kredensial yang sama) dan
gratis (Cloudflare R2 free tier 10 GB/bulan — cukup untuk dump harian).

---

## 1. Setup cron (sekali, di VPS 2)

```bash
ssh root@62.171.185.56
cd /var/www/canquest
git pull origin master   # pastikan script backup terbaru ada

# Buat folder backup on-site
mkdir -p /var/backups/canquest

# Test run manual sekali (pastikan R2 + DB OK)
node scripts/backup-postgres-r2.cjs
# Harapan: "✓ Backup complete: canquest_prod_YYYY-MM-DD_HHMM.dump (R2 + local on-site)"
```

Lalu install cron:

```bash
# Edit crontab root
crontab -e

# Tambahkan baris ini (backup harian jam 3:00 pagi):
0 3 * * * /usr/bin/node /var/www/canquest/scripts/backup-postgres-r2.cjs >> /var/log/canquest-backup.log 2>&1
```

Verifikasi cron terpasang:

```bash
crontab -l | grep canquest-backup
```

### Prasyarat env

`apps/api/.env` sudah punya semua var ini (script membacanya otomatis):
- `DATABASE_URL` — connection string `canquest_prod`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`

Opsional override:
- `BACKUP_R2_PREFIX` (default `backups/postgres/`)
- `BACKUP_LOCAL_DIR` (default `/var/backups/canquest`)
- `BACKUP_RETENTION_DAYS` (default `30` — hapus backup R2 lebih tua)
- `BACKUP_LOCAL_KEEP` (default `7` — keep 7 copy di disk VPS)

---

## 2. Verifikasi backup berjalan

### Cek log
```bash
tail -30 /var/log/canquest-backup.log
```

### Cek backup on-site
```bash
ls -lh /var/backups/canquest/
# Harapan: file canquest_prod_YYYY-MM-DD_0300.dump, ukuran ±2-5 MB
```

### Cek backup di R2
```bash
# Pakai rclone / aws-cli, atau cek via dashboard Cloudflare R2 → bucket → objects
# Folder: backups/postgres/
```

### Test restore (disarankan tiap bulan)
Restore ke scratch DB untuk pastikan dump tidak corrupt (lihat bagian 3).

---

## 3. Restore procedure

### Skenario A: Restore ke database baru (test verifikasi)

```bash
# Buat DB scratch
sudo -u postgres psql -c 'CREATE DATABASE canquest_restore_test OWNER canquest;'

# Restore dari file on-site
export PATH="/usr/lib/postgresql/17/bin:$PATH"   # pakai pg_restore versi tinggi
pg_restore -d "postgresql://canquest:<PW>@127.0.0.1:5432/canquest_restore_test" \
  -n public --no-owner --no-privileges --no-comments \
  /var/backups/canquest/canquest_prod_<tanggal>.dump

# Verify row count
psql "postgresql://canquest:<PW>@127.0.0.1:5432/canquest_restore_test" \
  -c 'SELECT count(*) FROM "User";'

# Hapus DB test
sudo -u postgres psql -c 'DROP DATABASE canquest_restore_test;'
```

### Skenario B: Disaster recovery (VPS hilang / disk rusak)

1. **Siapkan VPS baru** (atau rebuild) — install Postgres, restore repo dari GitHub
2. **Create database `canquest_prod`** + user `canquest` (lihat `docs/MIGRATION_SUPABASE_TO_VPS2.md`)
3. **Download backup dari R2** (dashboard Cloudflare R2 → bucket → `backups/postgres/` → download `.dump`)
4. **Restore**:
   ```bash
   export PATH="/usr/lib/postgresql/17/bin:$PATH"
   pg_restore -d "postgresql://canquest:<PW>@127.0.0.1:5432/canquest_prod" \
     -n public --no-owner --no-privileges --no-comments \
     canquest_prod_<tanggal>.dump
   ```
5. **Edit `.env`** → `DATABASE_URL` + `DIRECT_URL` ke `canquest_prod` lokal
6. **Start API**: `pm2 restart canquest-api --update-env`

> Data maksimal hilang = 24 jam (interval backup harian). Kalau butuh RPO lebih
> kecil, tambah cron kedua di siang hari, atau naikkan ke tiap 6 jam.

### Skenario C: Rollback transaksi spesifik (point-in-time)

Dump harian adalah **snapshot penuh**, bukan WAL archive. Kalau butuh
point-in-time recovery (mis. undo transaksi jam 14:00), itu tidak didukung
oleh setup ini. Untuk skala saat ini, snapshot harian cukup. Naikkan ke
WAL archiving (pgBackRest/barman) hanya kalau requirement RPO < 24 jam.

---

## 4. Monitoring (opsional tapi disarankan)

### Alert kalau backup gagal
Tambah di cron — kirim notifikasi kalau script exit non-zero. Contoh pakai
webhook Discord/Telegram (set `BACKUP_WEBHOOK_URL` di env):

```bash
0 3 * * * /usr/bin/node /var/www/canquest/scripts/backup-postgres-r2.cjs >> /var/log/canquest-backup.log 2>&1 || curl -s -X POST -d "content=CanQuest backup FAILED $(date)" $BACKUP_WEBHOOK_URL
```

### Alert kalau backup tidak jalan 2 hari
Cek via cron terpisah:
```bash
0 9 * * * find /var/backups/canquest -name "*.dump" -mtime -2 | grep -q . || echo "WARNING: no backup in 48h"
```

---

## 5. Checklist operasional bulanan

- [ ] Cek `/var/log/canquest-backup.log` tidak ada error beruntun
- [ ] Cek `/var/backups/canquest/` punya file hari ini
- [ ] Test restore ke scratch DB (bagian 3 skenario A) — pastikan dump valid
- [ ] Cek R2 storage usage tidak mendekati free tier limit (10 GB)
- [ ] Rotasi: konfirmasi retention bekerja (backup lama terhapus otomatis)
