# Migrasi Database: Supabase → Postgres di VPS 2

> **Tujuan:** pindahkan database production dari Supabase (cloud, berbayar/limit)
> ke Postgres yang berjalan **lokal di VPS 2** (`62.171.185.56`) — backend &
> database di mesin yang sama, gratis.
>
> **Yang TIDAK berubah:** Frontend (Vercel), VPS 1 (Canton node + Keycloak),
> auth (JWT+bcrypt di API), config Canton/WireGuard.
>
> **Skrip:** [`scripts/migrate-supabase-to-vps2.sh`](../scripts/migrate-supabase-to-vps2.sh)

## Prasyarat

| Item | Cek |
|------|-----|
| Akses SSH ke VPS 2 | `ssh root@62.171.185.56` |
| Docker + docker compose plugin | `docker compose version` |
| `postgresql-client` (pg_dump/psql/​pg_restore) | `apt install -y postgresql-client` |
| Direct connection string Supabase (port **5432**, BUKAN pooler 6543) | dashboard Supabase → Settings → Database → Connection string → **URI** (Session mode / direct) |
| IP VPS 2 di-allowlist Supabase | dashboard Supabase → Settings → Database → Network restrictions (atau allow all sementara) |

> ⚠️ **Penting soal port Supabase:** gunakan connection string **port 5432**
> (direct). Jangan pakai pooler port 6543 — prepared statement bisa bikin
> `pg_dump` gagal di tahap tertentu.

---

## 0. Cek resource VPS 2 (jangan dilewati)

Postgres + Redis + NestJS berjalan bareng di VPS 2. Pastikan cukup:

```bash
free -h          # idealnya RAM ≥ 2 GB free untuk Postgres
df -h /          # disk ≥ 5 GB free
docker ps        # lihat apa yang sudah jalan
```

Jika RAM sempit (< 2 GB), hentikan container non-esensial dulu, atau pertimbangkan
VPS lebih besar. Postgres 16 Alpine + Redis 7 ~butuh 200–400 MB saat idle.

---

## 1. Tarik kode terbaru & start database

```bash
ssh root@62.171.185.56
cd /var/www/canquest
git pull origin master
```

Start Postgres + Redis (baca `POSTGRES_*` dari `apps/api/.env`):

```bash
# Set password dulu kalau belum (di apps/api/.env):
#   POSTGRES_USER=canquest
#   POSTGRES_DB=canquest_app
#   POSTGRES_PASSWORD=<password-kuat-samakan-dengan-DATABASE_URL>
docker compose up -d
docker compose ps            # dua service harus "healthy"
docker compose logs postgres | tail
```

Verifikasi koneksi lokal:

```bash
psql "postgresql://canquest:<PASSWORD>@localhost:5432/canquest_app" -c "\l"
```

---

## 2. (Dry run) Validasi migrasi tanpa menulis

Tambahkan sementara kredensial Supabase ke `apps/api/.env` (filenya sudah
di-gitignore, aman):

```bash
# apps/api/.env — tambahkan baris ini untuk proses migrasi saja
SUPABASE_DIRECT_URL="postgresql://postgres:<PW>@db.<PROJ>.supabase.co:5432/postgres"
```

Jalankan dry-run (tidak menyentuh DB target):

```bash
bash scripts/migrate-supabase-to-vps2.sh --dry-run
```

Harapan: semua cek ✓ (source reachable, target reachable, row count terbaca).
Kalau gagal, lihat pesan error — umumnya: IP belum di-allowlist Supabase, atau
port salah (6543).

---

## 3. Jalankan migrasi (ada downtime singkat)

> **Downtime ± 5–15 menit** saat data dipindahkan & API di-switch. Lakukan saat
> traffic rendah, atau pasang maintenance window.

Dump full (schema + data + `_prisma_migrations`) dari Supabase → restore ke VPS 2:

```bash
bash scripts/migrate-supabase-to-vps2.sh
```

Skrip akan:
1. Test koneksi source & target
2. Catat row count tabel kunci (User, Quest, CcTransaction)
3. `pg_dump` Supabase → `.migration-dumps/supabase_<ts>.dump`
4. Drop & recreate schema `public` di target (bersih)
5. `pg_restore` ke Postgres VPS 2
6. Verifikasi row count target == source

**Harapan output:** `━━━ Migration succeeded ━━━` dengan row count match.

Bila muncul `✗ MISMATCH`: target tidak lengkap. Jangan switch DATABASE_URL.
Dump tersimpan di `.migration-dumps/` untuk investigasi.

---

## 4. Arahkan API ke Postgres VPS 2

Edit `apps/api/.env` — ubah **kedua** URL ke localhost:

```bash
# apps/api/.env
DATABASE_URL=postgresql://canquest:<PASSWORD>@localhost:5432/canquest_app
DIRECT_URL=postgresql://canquest:<PASSWORD>@localhost:5432/canquest_app
```

Hapus baris `SUPABASE_DIRECT_URL` (tidak diperlukan lagi). Restart API agar env
terbaca ulang:

```bash
pm2 restart canquest-api --update-env
pm2 logs canquest-api --lines 30 --nostream
```

---

## 5. Verifikasi

```bash
# Health check API
curl -s http://localhost:3001/api/health

# Cek beberapa data langsung di DB baru
psql "$DATABASE_URL" -c "SELECT count(*) FROM \"User\";"
psql "$DATABASE_URL" -c "SELECT count(*) FROM \"Quest\";"

# Login test via API (dari browser / curl) — pastikan auth JWT jalan
```

Uji end-to-end dari browser: login, lihat quest, cek wallet/CC balance.

---

## 6. Backup lokal + matikan Supabase

Setelah stabil (tunggu 1–3 hari), pindahkan dump ke tempat aman lalu pause
project Supabase:

```bash
# Download dump dari VPS 2 ke lokal (jaga-jaga)
scp root@62.171.185.56:/var/www/canquest/.migration-dumps/supabase_*.dump ./
```

Lalu di dashboard Supabase: **Settings → General → Pause project** (bukan delete,
agar masih bisa di-restore dalam 90 hari). Setelah yakin seminggu, baru delete.

---

## Rollback (jika ada masalah)

Selama Supabase **belum** di-pause/delete, rollback seketika:

```bash
# Kembalikan DATABASE_URL ke Supabase di apps/api/.env
# (DIRECT_URL bisa pakai pooler 6543 atau direct 5432)
pm2 restart canquest-api --update-env
```

Data Postgres VPS 2 aman di-drop tanpa dampak (selama Supabase masih aktif):

```bash
psql "postgresql://canquest:<PW>@localhost:5432/canquest_app" <<'SQL'
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
SQL
```

---

## Catatan

- **Auth BUKAN Supabase Auth** — jadi tidak ada migrasi user/identity provider.
  Login/register tetap lewat JWT+bcrypt di API. Migrasi ini murni data Postgres.
- **Prisma migrations** (`_prisma_migrations` table) ikut ter-dump & restore, jadi
  `prisma migrate deploy` berikutnya tahu state terakhir — tidak akan re-run
  migration lama.
- **Zero-downtime opsional** (dual-write / logical replication) tersedia untuk
  skala besar, tapi berlebih untuk skala saat ini.
- **Resource:** Postgres+Redis+API bareng butuh RAM ~1–1.5 GB saat aktif. VPS 2
  minimum recommended 2 GB RAM.

---

## Gotcha aktual (ditemukan saat migrasi pertama — sudah di-handle script)

Skrip `migrate-supabase-to-vps2.sh` sudah mengatasi ketiga hal ini otomatis,
tapi didokumentasikan di sini agar bisa tracing kalau ada masalah.

### 1. pg_dump version mismatch
```
pg_dump: error: aborting because of server version mismatch
  server version: 17.6; pg_dump version: 16.14
```
**Sebab:** Supabase = PostgreSQL 17, tapi `pg_dump` default di PATH VPS = 16.
PostgreSQL client tools v17 terinstall di `/usr/lib/postgresql/17/bin/` tapi
tidak di-prioritaskan di PATH. `pg_dump` harus **>= versi source server**.

**Fix script:** deteksi source `server_version`, cari binary `pg_dump` versi
tertinggi di `/usr/lib/postgresql/*/bin/`, abort kalau terlalu lama.

**Manual (kalau perlu):** `export PATH="/usr/lib/postgresql/17/bin:$PATH"`

### 2. Extension pg_stat_statements (superuser-only)
```
psql: ERROR: permission denied to create extension "pg_stat_statements"
HINT: Must be superuser to create this extension.
```
**Sebab:** dump Supabase menyertakan extension monitoring yang butuh superuser.

**Fix script:** filter ke `-n public` (lihat #3) → extension otomatis skip.

### 3. Schema "auth"/"storage" Supabase + transaction_timeout (PG17 GUC)
```
ERROR: schema "auth" already exists
ERROR: unrecognized configuration parameter "transaction_timeout"
```
**Sebab:** dump full Supabase mencakup semua schema internal (auth, storage,
realtime, graphql_public) yang tidak dibutuhkan app. Ditambah `SET transaction_timeout`
itu GCU baru PG17 yang tidak dikenal target <17.

**Fix script:** convert custom-format dump → plain SQL dengan filter `-n public`
(HANYA schema public, tempat data app: User, Quest, _prisma_migrations, dll.),
buang baris `transaction_timeout`, restore via `psql`. Skip `pg_restore` langsung
yang kena kedua error di atas.

---

## Pemetaan nama database (catatan)

Saat migrasi pertama (7 Agustus 2026), target yang dipakai = `canquest_prod`
(database baru), bukan `canquest_app`. Sebab VPS 2 sebelumnya punya DB lokal
`canquest_mainnet` berisi snapshot user lama (5 Juli) — dipertahankan sebagai
backup, bukan ditimpa. Setelah verify stabil, DB lokal lama di-drop.

**Arsitektur final:** database production = `canquest_prod` di Postgres natif
VPS 2 (`localhost:5432`), user `canquest`. Frontend = Vercel. Canton/Keycloak = VPS 1.
