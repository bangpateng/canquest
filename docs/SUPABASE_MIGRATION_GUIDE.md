# 🚀 Migrasi Auth + Database ke Supabase — Panduan Lengkap

> **Tujuan:** Pindahkan sistem login/register (email+password) dan seluruh database PostgreSQL ke Supabase, tanpa kehilangan data 2k user (points, wallet, CC, quest completion tetap utuh).
>
> **Hasil akhir:** User login pakai password lama (tanpa reset), data pindah ke Supabase Singapore, 1 tempat maintenance.
>
> **Branch git:** `feat/supabase-auth-migration`
> **Tier:** Free ($0/bln) dengan mitigasi anti-pause + manual backup
> **Region:** Singapore (`ap-southeast-1`)

---

## 📑 Daftar Isi

1. [Arsitektur & Desain Kunci](#-arsitektur--desain-kunci)
2. [Persiapan: Backup WAJIB](#-persiapan-backup-wajib)
3. [Phase 0 — Provisioning Supabase](#-phase-0--provisioning-supabase)
4. [Phase 1 — Migrasi Database](#-phase-1--migrasi-database-data-pindah-utuh)
5. [Phase 2 — Link Auth + Import 2k User](#-phase-2--link-auth--import-2k-user)
6. [Phase 3 — Test & Validasi](#-phase-3--test--validasi)
7. [Phase 4 — Cutover (Go-Live)](#-phase-4--cutover-go-live)
8. [Phase 5 — Pasca Cutover](#-phase-5--pasca-cutover)
9. [Mitigasi Free Tier](#-mitigasi-free-tier-keep-alive--backup)
10. [Rollback Plan](#-rollback-plan)
11. [Troubleshooting](#-troubleshooting)

---

## 🧩 Arsitektur & Desain Kunci

**Baca ini dulu** sebelum mulai — supaya paham kenapa langkah-langkahnya begini.

### Apa yang berubah
| Komponen | Sebelum | Sesudah |
|----------|---------|---------|
| **Auth** (login/register/OTP) | NestJS + bcrypt + JWT HS256 | **Supabase Auth** (email OTP, forgot/reset password bawaan) |
| **Session** | `cq_access`/`cq_refresh` cookie (JWT HS256 + RefreshToken table) | `sb-*-access-token`/`sb-*-refresh-token` cookie (JWT RS256 Supabase) |
| **Database** | PostgreSQL lokal di VPS | **PostgreSQL di Supabase** (pindah rumah, isi sama) |
| **Password storage** | bcrypt cost-12 di tabel `User.passwordHash` | bcrypt di `auth.users` Supabase (hash lama dipertahankan) |

### Apa yang TIDAK berubah
- **Data 2k user**: points, CC balance, quest completion, referral, wallet binding — semua ikut ter-copy via `pg_dump`
- **`User.id` (cuid)**: tetap sebagai PK. Dipakai sebagai FK di 12+ tabel transaksional → tidak diubah tipe-nya
- **Business logic**: quest, earn, CC, wallet, twitter binding → tidak tersentuh
- **Admin panel auth** (`ADMIN_JWT_SECRET`): sistem terpisah, tetap
- **Keycloak** (Canton ledger identity): bukan auth user app, tetap

### Desain link Supabase ↔ User lokal
```
auth.users (Supabase)          User (Prisma, tabel lokal di DB Supabase)
┌────────────────────┐         ┌──────────────────────────────┐
│ id: UUID (sub JWT) │ ◄────── │ authUserId: UUID @unique     │
│ email              │  lookup │ id: cuid (PK, FK 12+ tabel)  │
│ encrypted_password │         │ email, earnPoints, canton... │
└────────────────────┘         └──────────────────────────────┘
```
JWT Supabase `sub` = UUID → Nest lookup `User.authUserId` → dapat `User.id` (cuid) → semua logic jalan.

### Feature flag (safety)
Semua kode di-gate oleh `SUPABASE_AUTH_ENABLED`:
- `false` = mode HS256 lama (rollback safety, default)
- `true` = mode Supabase Auth

---

## 💾 Persiapan: Backup WAJIB

> ⚠️ **JANGAN lewati step ini.** Ini rollback point Anda kalau migrasi bermasalah.

### A. Backup database lokal

Jalankan di **VPS** tempat PostgreSQL lokal berjalan:

```bash
# Pastikan DATABASE_URL lokal aktif (cek apps/api/.env)
echo $DATABASE_URL
# expected: postgresql://canquest:****@localhost:5432/canquest_app

# Backup full — custom format (kompresi built-in, support selective restore)
mkdir -p ~/backups
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --file=~/backups/canquest-pre-supabase-$(date +%Y%m%d-%H%M%S).dump

# Verifikasi file backup ada & tidak kosong
ls -lh ~/backups/canquest-pre-supabase-*.dump
```

### B. Download backup ke lokal (off-site)

```bash
# Dari laptop/PC Anda
scp user@vps-anda:~/backups/canquest-pre-supabase-*.dump ./backups/

# Atau pakai sftp/rsync. SIMPAN di 2 tempat (laptop + cloud drive).
```

### C. Backup .env saat ini (sebelum diubah)

```bash
cp apps/api/.env apps/api/.env.pre-supabase-backup
cp apps/web/.env apps/web/.env.pre-supabase-backup
```

✅ **Checkpoint**: file `.dump` ada di VPS + laptop. Lanjut Phase 0.

---

## 🟢 Phase 0 — Provisioning Supabase

### 0.1 Buat project (~5 menit)

1. Buka https://supabase.com → **Sign in** (GitHub/Google/email)
2. Klik **New project**
3. Isi form:
   - **Name**: `canquest` (atau bebas)
   - **Database Password**: klik **Generate a password** →
     🔴 **COPY & SIMPAN DI PASSWORD MANAGER** (tidak bisa di-reset!)
   - **Region**: `Southeast Asia (Singapore)` → `ap-southeast-1`
   - **Pricing Plan**: ✅ **Free** ($0/month)
4. Klik **Create new project** → tunggu 2-3 menit

### 0.2 Catat kredensial

Buka project → **Project Settings** (⚙️ kiri bawah) → **API**:

```
Project URL:        https://XXXXXXX.supabase.co     ← catat
anon public key:    eyJhbGciOi...                   ← catat (public, aman)
service_role key:   eyJhbGciOi...                   ← catat (RAHASIA! server only)
```

Lalu **Project Settings** → **Database** → **Connection string**:
```
Direct connection:  postgresql://postgres:[PASSWORD]@db.XXXXXXX.supabase.co:5432/postgres
```

> 💡 Catat semua di password manager / `.env` lokal. **JANGAN commit service_role ke git.**

### 0.3 Konfigurasi Auth

Buka project → **Authentication** → **Providers**:

1. **Email**: pastikan **ENABLED** ✅
2. Klik **Email** untuk expand:
   - **Confirm email**: ON (Supabase akan kirim OTP verification)
   - **Minimum password length**: `8` (match sistem Anda saat ini)

Lalu **Authentication** → **URL Configuration**:

1. **Site URL**: `http://localhost:3000` (dev)
   - Nanti ganti ke `https://canquest.cc` saat prod
2. **Redirect URLs**: klik **Add URL** → tambahkan satu per satu:
   - `http://localhost:3000/**`
   - `https://canquest.cc/**`

### 0.4 Buat RPC function untuk import user

> Script migrasi 2k user butuh function ini di Supabase.

1. Buka project → **SQL Editor** (ikon `>_` di sidebar kiri)
2. Klik **New query**
3. **Buka file** `apps/api/scripts/supabase-migrate-legacy-user-function.sql`
4. **Copy seluruh isinya** → paste ke SQL Editor
5. Klik **Run** (tombol hijau ▶)
6. Output harus: `Success. No rows returned.`

✅ **Checkpoint**: function `migrate_legacy_user` ada (cek di sidebar kiri → **Database** → **Functions** → ada `public.migrate_legacy_user`).

---

## 🟢 Phase 1 — Migrasi Database (data pindah utuh)

### 1.1 Set env sementara untuk migrasi

Di laptop/PC Anda (tempat script dijalankan), buat env:

```bash
# Sumber: DB lokal (via SSH tunnel ke VPS, atau copy dump)
export LOCAL_DATABASE_URL="postgresql://canquest:PASSWORD@localhost:5432/canquest_app"

# Tujuan: Supabase Singapore
export SUPABASE_DATABASE_URL="postgresql://postgres:[SUPABASE-PASSWORD]@db.XXXXXXX.supabase.co:5432/postgres"

# Supabase API (untuk import user nanti)
export SUPABASE_URL="https://XXXXXXX.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ...service_role..."
```

### 1.2 Restore dump ke Supabase

Ada 2 cara — pilih **A** (lebih aman) atau **B** (langsung).

#### Cara A: Restore dari backup yang sudah dibuat (RECOMMENDED)

```bash
# Asumsi backup dari "Persiapan" sudah ada di ~/backups/
BACKUP_FILE=$(ls -t ~/backups/canquest-pre-supabase-*.dump | head -1)
echo "Restore dari: $BACKUP_FILE"

pg_restore "$BACKUP_FILE" \
  --dbname="$SUPABASE_DATABASE_URL" \
  --no-owner --no-privileges \
  --schema=public \
  --verbose 2>&1 | tee ~/backups/restore-log-$(date +%Y%m%d).txt
```

**Kalau error FK violation** (self-relation `referredById`):

```bash
# Disable trigger/constraint selama restore, lalu re-enable
pg_restore "$BACKUP_FILE" \
  --dbname="$SUPABASE_DATABASE_URL" \
  --no-owner --no-privileges \
  --schema=public \
  --disable-triggers \
  --no-data-for-failed-tables \
  --verbose
```

Atau pakai psql dengan `session_replication_role`:

```bash
psql "$SUPABASE_DATABASE_URL" -c "SET session_replication_role = 'replica';"
# lalu jalankan pg_restore
psql "$SUPABASE_DATABASE_URL" -c "SET session_replication_role = 'origin';"
```

#### Cara B: Dump langsung dari VPS → pipe ke Supabase

```bash
# Dari VPS (DB lokal) — pipe langsung tanpa file perantara
pg_dump "$LOCAL_DATABASE_URL" \
  --format=custom \
  --no-owner --no-privileges \
  | pg_restore \
  --dbname="$SUPABASE_DATABASE_URL" \
  --no-owner --no-privileges \
  --schema=public
```

⚠️ Cara B lebih cepat tapi **tanpa backup file** — tidak ada rollback point. Pakai Cara A.

### 1.3 Verifikasi integritas data (CRITICAL)

```bash
cd apps/api

# Bandingkan count + sum antara DB lokal vs Supabase
node scripts/verify-supabase-migration.cjs
```

**Output yang diharapkan** (semua status `OK`):

```
TABLE                       LOCAL  SUPABASE    DIFF   STATUS
user                          2000       2000       0       OK
ccBalance                      500        500       0       OK
ccTransaction               15000      15000       0       OK
questCompletion              8000       8000       0       OK
...
User (sum earnPoints)        45000      45000       0       OK
CcBalance (sum microCC)    2000000    2000000       0       OK
User (authUserId != null)        0          0       0     INFO

[verify] PASS — semua metric match.
```

🔴 **Kalau ada MISMATCH**: JANGAN lanjut. Cek:
- Apakah ada write ke DB lokal setelah backup dibuat? → re-dump
- Apakah restore ter-filter? → cek log, restore ulang tanpa `--no-data-for-failed-tables`

✅ **Checkpoint**: semua tabel count + sum match. Lanjut Phase 2.

---

## 🟢 Phase 2 — Link Auth + Import 2k User

### 2.1 Switch DATABASE_URL ke Supabase + Prisma migration

```bash
cd apps/api

# Update .env: DATABASE_URL → Supabase (direct connection)
# Edit apps/api/.env, ganti baris DATABASE_URL:
#   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.XXXXXXX.supabase.co:5432/postgres

# Jalankan migration untuk tambah kolom authUserId
PRISMA_CLIENT_ENGINE_TYPE=binary PRISMA_CLI_QUERY_ENGINE_TYPE=binary \
  npx prisma migrate dev --name add_supabase_auth_link
```

Output harus: `Applied migration add_supabase_auth_link`.

> ⚠️ Migration ini dijalankan **terhadap DB Supabase** (karena DATABASE_URL sudah di-switch). Kolom `authUserId` akan ditambah ke tabel `User`.

### 2.2 Dry-run import user (TEST dulu, jangan apply)

```bash
cd apps/api

# Dry-run: lihat 5 sample user yang akan di-migrate
node scripts/migrate-users-to-supabase.cjs
```

Output:
```
[migrate-users] mode = DRY-RUN (--apply untuk eksekusi)
[migrate-users] 2000 user akan di-migrate (belum ter-link).
[migrate-users] DRY-RUN — 5 sample pertama:
  - user1@example.com (id=clxxx..., hash=$2a$12$abcd...)
  - user2@example.com (id=clyyy..., hash=$2a$12$efgh...)
  ...
```

✅ **Cek**: jumlah user masuk akal (~2000), hash berformat `$2a$` / `$2b$` (bcrypt valid).

### 2.3 Test batch kecil dulu (10 user)

```bash
# Apply ke 10 user pertama untuk validasi
node scripts/migrate-users-to-supabase.cjs --apply --limit 10
```

Output:
```
[migrate-users] SELESAI:
  - Berhasil dibuat baru : 10
  - Reused (sudah ada)   : 0
  - Gagal                : 0
```

### 2.4 Validasi: test login 1 user sampling

> 🔴 **Step penting**: pastikan user bisa login pakai password LAMA.

```bash
# Pakai Supabase API untuk test login 1 user (yang sudah di-migrate)
curl -X POST "${SUPABASE_URL}/auth/v1/signup" \
  -H "apikey: ${SUPABASE_URL_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"user1@example.com","password":"PASSWORD_LAMA_USER_TERSEBUT"}'
```

> ⚠️ Anda harus tahu password asli user sampling (mis. akun test Anda sendiri). Login harus **succeed** (dapat `access_token`).

Kalau **gagal** (`Invalid credentials`):
- Cek hash bcrypt di `auth.users.encrypted_password` apakah valid: `\d auth.users` atau query `SELECT email, encrypted_password FROM auth.users LIMIT 5;`
- Hash harus mulai `$2a$` atau `$2b$` (Supabase support keduanya)
- Cost factor (angka setelah `$2a$`) tidak masalah — GoTrue baca dari prefix

### 2.5 Import semua 2k user

Setelah test sampling OK:

```bash
node scripts/migrate-users-to-supabase.cjs --apply
```

Proses ini import 2000 user + link `authUserId`. Estimasi ~2-5 menit.

Output:
```
[migrate-users] progress: 100/2000 ...
[migrate-users] progress: 200/2000 ...
...
[migrate-users] SELESAI:
  - Berhasil dibuat baru : 2000
  - Reused (sudah ada)   : 0
  - Gagal                : 0
```

✅ **Checkpoint**: count `User WHERE authUserId != null` = 2000 (atau total user verified).

---

## 🟢 Phase 3 — Test & Validasi

### 3.1 Jalankan API pakai Supabase DB + Auth

```bash
cd apps/api

# Edit .env:
#   DATABASE_URL=postgresql://postgres:...@db.XXXXXXX.supabase.co:5432/postgres
#   SUPABASE_AUTH_ENABLED=true                              ← UBAH KE true
#   SUPABASE_URL=https://XXXXXXX.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=eyJ...

npm run start:dev
```

Cek log startup tidak ada error.

### 3.2 Smoke test endpoint

```bash
# Health check (cek koneksi DB Supabase)
curl http://localhost:3001/api/health/db
# Expected: {"ok":true,"ms":<rendah>,"error":null}

# Login via Supabase (dapat JWT RS256)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user1@example.com","password":"PASSWORD_LAMA","turnstileToken":""}'
# Expected: {"ok":true} + Set-Cookie: sb-XXXXXXX-access-token=...

# Pakai token itu untuk /me
curl http://localhost:3000/api/me \
  -H "Cookie: sb-XXXXXXX-access-token=TOKEN_DARI_LOGIN"
# Expected: {"id":"cl...","email":"...","earnPoints":<sama dengan DB lama>}
```

### 3.3 Cek data points/CC tidak berubah

```bash
# Query langsung ke Supabase
psql "$SUPABASE_DATABASE_URL" -c "
  SELECT email, \"earnPoints\" FROM \"User\" WHERE email='user1@example.com';
"
# earnPoints harus SAMA dengan sebelum migrasi
```

### 3.4 Test frontend lokal

```bash
cd apps/web

# Edit .env.local (atau .env):
#   NEXT_PUBLIC_SUPABASE_URL=https://XXXXXXX.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...anon...
#   NEXT_PUBLIC_WEB_ORIGIN=http://localhost:3000

npm run dev
```

Buka http://localhost:3000 → coba:
- ✅ Login dengan akun lama (password lama)
- ✅ Register akun baru (OTP email dari Supabase)
- ✅ Lihat dashboard → points, CC, quest history tampil
- ✅ Logout → login ulang
- ✅ Reset password (forgot password → email dari Supabase)

---

## 🟢 Phase 4 — Cutover (Go-Live)

> ⏰ **Lakukan dalam maintenance window** (estimasi 30-60 menit). Pilih waktu traffic rendah (mis. dini hari WIB).

### 4.1 Aktifkan maintenance mode

```bash
# Via admin panel, atau:
psql "$LOCAL_DATABASE_URL" -c \
  "INSERT INTO \"AppSetting\" (key, value, \"updatedAt\") VALUES ('maintenance_enabled','true',now()) ON CONFLICT (key) DO UPDATE SET value='true';"
```

Sekarang user yang akses dapp lihat halaman `/maintenance`.

### 4.2 Final incremental sync (kalau ada delta sejak backup Phase 1)

> Kalau dari backup Phase 1 sampai sekarang ada user baru / activity, perlu sync ulang.

```bash
# Pilihan cepat: re-dump ulang (kalau delta besar)
pg_dump "$LOCAL_DATABASE_URL" \
  --format=custom --no-owner --no-privileges \
  --file=~/backups/canquest-final-$(date +%Y%m%d-%H%M%S).dump

# Drop schema public di Supabase, restore ulang
psql "$SUPABASE_DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pg_restore ~/backups/canquest-final-*.dump \
  --dbname="$SUPABASE_DATABASE_URL" \
  --no-owner --no-privileges --schema=public --verbose

# Re-link user (script idempotent — skip yang sudah ada)
node scripts/migrate-users-to-supabase.cjs --apply
```

> 💡 Kalau delta kecil (hanya beberapa user baru), bisa skip step ini dan import manual user baru saja.

### 4.3 Deploy code + env baru ke production

**Di VPS (production):**

```bash
cd /path/to/can

# Pull branch migrasi
git fetch origin
git checkout feat/supabase-auth-migration
git pull origin feat/supabase-auth-migration

# Build
cd apps/api && npm run build
cd ../web && npm run build
```

**Update `.env` production:**

```bash
# apps/api/.env
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.XXXXXXX.supabase.co:5432/postgres
SUPABASE_AUTH_ENABLED=true
SUPABASE_URL=https://XXXXXXX.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...service_role...
# JWT_ACCESS_SECRET tetap (dipakai untuk SSE token)
# OTP_HMAC_SECRET tetap (untuk rollback path)

# apps/web/.env
NEXT_PUBLIC_SUPABASE_URL=https://XXXXXXX.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...anon...
NEXT_PUBLIC_WEB_ORIGIN=https://canquest.cc
```

**Restart services:**

```bash
# pm2 (sesuai infra/pm2.ecosystem.config.js)
pm2 restart all

# Atau systemd
sudo systemctl restart canquest-api
sudo systemctl restart canquest-web
```

### 4.4 Smoke test production

```bash
# Health
curl https://canquest.cc/api/health/db

# Coba login via browser (akun Anda sendiri)
# - Login sukses pakai password lama ✅
# - Dashboard tampil, points benar ✅
# - Bisa submit quest ✅
# - Realtime SSE jalan ✅
```

### 4.5 Matikan maintenance mode

```bash
psql "$SUPABASE_DATABASE_URL" -c \
  "UPDATE \"AppSetting\" SET value='false' WHERE key='maintenance_enabled';"
```

🎉 **Cutover selesai!** User sekarang login via Supabase.

---

## 🟢 Phase 5 — Pasca Cutover

### 5.1 Monitoring 24-48 jam pertama

Pantau:
- **Error rate** login (Supabase dashboard → Authentication → Logs)
- **Latency** API (terutama `/api/me`, `/api/health/db`)
- **Complain user** di channel Discord/Telegram

### 5.2 Set up mitigasi Free tier (WAJIB, lihat detail di section bawah)

```bash
# 1. Keep-alive (anti auto-pause)
crontab -e
# Tambah:
0 */6 * * * /usr/bin/node /path/to/can/apps/api/scripts/keepalive-supabase.cjs >> /var/log/supabase-keepalive.log 2>&1

# 2. Backup harian
0 3 * * * /usr/bin/node /path/to/can/apps/api/scripts/backup-supabase.cjs >> /var/log/supabase-backup.log 2>&1
```

### 5.3 Cleanup legacy (1-2 minggu setelah stabil)

Setelah yakin semua jalan:

```bash
# Prisma migration: drop kolom legacy
# Buat migration baru di schema.prisma:
#   - hapus: passwordHash, otpCodeHash, otpExpiresAt, otpAttempts dari User
#   - hapus: model RefreshToken, model PasswordReset
npx prisma migrate dev --name drop_legacy_auth_fields

# Hapus ResendEmailService kalau semua email lewat Supabase SMTP
# Cleanup env: OTP_HMAC_SECRET (kalau tidak dipakai rollback)
```

---

## 🛡️ Mitigasi Free Tier (Keep-alive + Backup)

Free tier Supabase punya 2 risiko yang harus dimitigasi:

### Risiko 1: Auto-pause setelah 7 hari idle
Database berhenti kalau tidak ada API call selama 7 hari → user mendapat error saat akses (cold start 30-60 detik).

**Solusi A — UptimeRobot (RECOMMENDED, paling mudah):**
1. Daftar gratis di https://uptimerobot.com
2. **Add New Monitor** → type **HTTP(s)**
3. URL: `https://canquest.cc/api/health/db`
4. Interval: **5 minutes** (gratis)
5. Save

→ Bonus: dapat **uptime alert** gratis + keep-alive otomatis.

**Solusi B — Cron di VPS:**
```bash
crontab -e
# Ping tiap 6 jam
0 */6 * * * /usr/bin/node /path/to/can/apps/api/scripts/keepalive-supabase.cjs >> /var/log/supabase-keepalive.log 2>&1
```

### Risiko 2: Tidak ada backup otomatis
Kalau ada data corruption / salah hapus → **tidak bisa restore**.

**Solusi — Backup harian via cron:**
```bash
crontab -e
# Backup harian jam 3 pagi (retensi 14 hari otomatis)
0 3 * * * /usr/bin/node /path/to/can/apps/api/scripts/backup-supabase.cjs >> /var/log/supabase-backup.log 2>&1
```

**Off-site (RECOMMENDED):** sinkron backup ke R2/S3 setelahnya:
```bash
# Tambah setelah backup-supabase.cjs (atau bikin wrapper)
rclone sync ~/backups/ r2:canquest-backups/ --max-age 30d
```

---

## ↩️ Rollback Plan

Kalau setelah cutover ada masalah serius (user tidak bisa login massal, data error):

### Rollback cepat (5 menit)

```bash
# 1. Set flag kembali ke false
sed -i 's/SUPABASE_AUTH_ENABLED=true/SUPABASE_AUTH_ENABLED=false/' apps/api/.env

# 2. Set DATABASE_URL kembali ke lokal
sed -i 's|postgresql://postgres:.*@db.*supabase.co.*|postgresql://canquest:PASSWORD@localhost:5432/canquest_app|' apps/api/.env

# 3. Restart
pm2 restart all
```

→ Sistem balik ke mode HS256 lama. User yang belum re-login pakai token lama (masih valid). DB lokal masih utuh (read-only saat cutover, tidak ada write ke lokal).

### Kalau DB lokal juga bermasalah

```bash
# Restore dari backup pre-supabase
pg_restore ~/backups/canquest-pre-supabase-*.dump \
  --dbname="$LOCAL_DATABASE_URL" \
  --no-owner --no-privileges --schema=public --clean --if-exists
```

---

## 🆘 Troubleshooting

### Error: `relation "User" already exists` saat restore
Schema sudah ada (restore kedua kali). Pakai `--clean --if-exists`:
```bash
pg_restore BACKUP.dump --dbname=URL --no-owner --no-privileges --schema=public --clean --if-exists
```

### Error: FK violation saat restore (self-relation `referredBy`)
```bash
psql "$SUPABASE_DATABASE_URL" -c "SET session_replication_role = 'replica';"
# jalankan pg_restore
psql "$SUPABASE_DATABASE_URL" -c "SET session_replication_role = 'origin';"
```

### User tidak bisa login (password invalid)
1. Cek hash di Supabase: `SELECT email, encrypted_password FROM auth.users WHERE email='xxx';`
2. Hash harus mulai `$2a$` / `$2b$` (bcrypt)
3. Kalau hash kosong / rusak → re-import user itu via script (idempotent)

### Latency API tinggi setelah cutover
- Cek region Supabase (harus Singapore)
- Cek `curl https://canquest.cc/api/health/db` → `ms` harus < 100ms
- Kalau >500ms → mungkin VPS Anda jauh dari Singapore. Pertimbangkan pindah region (tapi butuh re-migrate data).

### `error: function migrate_legacy_user does not exist`
RPC function belum dibuat. Ulangi **Phase 0.4** (jalankan SQL di Supabase SQL Editor).

### RLS (Row Level Security) block query
Prisma pakai `service_role` key yang bypass RLS → seharusnya tidak kena. Tapi kalau ada query pakai `anon` key, RLS aktif. Cek di Supabase → **Database** → **Tables** → pastikan tidak ada policy yang memblok.

### Auth OTP email tidak terkirim
1. Cek Supabase → **Authentication** → **Users** → user ada?
2. Cek **Authentication** → **Logs** → ada error send email?
3. Free tier punya rate limit email (3/jam). Untuk volume tinggi, setup SMTP custom (Resend) di **Auth → Email Templates → SMTP settings**.

---

## 📞 Quick Reference

| Yang dicari | Lokasi |
|-------------|--------|
| Script import user | `apps/api/scripts/migrate-users-to-supabase.cjs` |
| RPC function SQL | `apps/api/scripts/supabase-migrate-legacy-user-function.sql` |
| Script verifikasi | `apps/api/scripts/verify-supabase-migration.cjs` |
| Script backup | `apps/api/scripts/backup-supabase.cjs` |
| Script keep-alive | `apps/api/scripts/keepalive-supabase.cjs` |
| Feature flag | `SUPABASE_AUTH_ENABLED` di `apps/api/.env` |
| Supabase env API | `apps/api/.env` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) |
| Supabase env Web | `apps/web/.env` (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) |
| Dashboard Supabase | https://supabase.com/dashboard → project `canquest` |

---

## ✅ Checklist Akhir

Sebelum bilang "migrasi selesai", pastikan semua ini ✅:

- [ ] Backup pre-supabase tersimpan di VPS + laptop
- [ ] Project Supabase Singapore Free dibuat
- [ ] RPC function `migrate_legacy_user` dibuat di Supabase
- [ ] DB berhasil di-restore ke Supabase
- [ ] `verify-supabase-migration.cjs` → semua `OK`
- [ ] Kolom `authUserId` ada (Prisma migration jalan)
- [ ] 2k user berhasil di-import (count match)
- [ ] Login test dengan password lama → sukses
- [ ] Frontend lokal: login/register/reset password jalan
- [ ] Production deploy + env update
- [ ] Smoke test production → login, dashboard, quest, realtime
- [ ] Maintenance mode dimatikan
- [ ] Keep-alive cron aktif (atau UptimeRobot)
- [ ] Backup harian cron aktif

---

**Estimasi waktu total:** 4-6 jam kerja (dengan testing). Bisa diselesaikan dalam 1 hari.
