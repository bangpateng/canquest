# Runbook — Non-Custodial Wallet Deployment (M0–M4)

> Status: semua kode selesai & lolos typecheck. Flag `EXTERNAL_WALLET_ENABLED`
> tetap **OFF** selama deploy (zero behavior change). Diverifikasi bertahap
> sebelum flag dinyalakan.

## Apa yang dideploy

- **Prisma migrations (2 baru):**
  - `20260824120000_external_wallet_fields` — kolom `walletKind`,
    `backupVerifiedAt` + backfill `custodial` untuk wallet existing.
  - `20260824130000_external_wallet_upgrade` — kolom `legacyPartyId` (M4).
- **API (apps/api):** wallet-sdk relay (external party + interactive
  submission), signing relay (send/token/offers/lock/unlock/claims/swap),
  upgrade custodial→external, endpoints `/party/sign/*`,
  `/party/wallet-external/*`, `/quests/:id/claim-external/prepare`,
  `/party/swap/prepare-external`. Dependency baru produksi:
    `@canton-network/wallet-sdk` (^1.4.0).
- **Web (apps/web):** key-manager browser, key ceremony, Settings wallet-key
  panel (+ upgrade card), passphrase modal, cabang external di semua flow
  transaksi. Dependency baru: `@noble/ed25519` (^3.1.0).

## Pra-deploy (di PC)

1. Commit + push semua perubahan ke branch/master.
2. Pastikan `npm run build` (api) dan build web lolos lokal.
3. **Backup DB dulu** (lihat RUNBOOK backup existing — `scripts/backup-postgres-r2.cjs`).

## Deploy API (VPS 2)

```bash
cd /var/www/canquest
git pull origin master

cd apps/api
npm ci            # memasang @canton-network/wallet-sdk

# Migrasi (2 migration baru)
npx prisma migrate deploy

npm run build
pm2 restart canquest-api
pm2 logs canquest-api --lines 50   # pastikan boot bersih
```

## Deploy Web (Vercel)

- Push ke repo → Vercel auto-deploy (atau `vercel --prod`).
- Tidak ada env baru yang wajib untuk web.

## Env API (VPS 2) — TAMBAHKAN, JANGAN dulu diisi true

```bash
# apps/api/.env
EXTERNAL_WALLET_ENABLED=false   # tetap OFF di deploy pertama
```

(Opsional dev/PC: `CANTON_DNS_OVERRIDES` untuk bypass DNS LAN mati —
TIDAK perlu di VPS.)

## Checklist verifikasi pasca-deploy (flag masih OFF)

1. `GET /api/health` → OK.
2. Login + buka wallet page user custodial existing → semua fungsi lama
   normal (send/lock/offers/claim/swap) — jalur lama tidak tersentuh.
3. `POST /api/party/wallet-external/prepare` → harus 503/400
   ("not enabled") — bukti flag bekerja.
4. Prisma: `SELECT username, "walletKind", "legacyPartyId" FROM "User"
   WHERE "cantonPartyId" IS NOT NULL;` → semua `custodial`, legacy NULL.

## Menyalakan (bertahap — setelah verifikasi)

### Tahap A — upgrade akun tes (wallet-lama kosong)

1. Login akun tes custodial di web → Settings → Wallet Key →
   **Upgrade Now** → ceremony (save raw hex! ) → selesai.
2. Verifikasi:
   - DB: user tsb `walletKind='external'`, `cantonPartyId` = party baru
     (`canquest-user-…`), `legacyPartyId` = party lama.
   - Chain: party lama tetap ada tapi kosong; party baru terdaftar
     (`/v2/parties/…` 200).
   - Flow: kirim 0.02 CC ke akun tes → offer masuk → Accept (sign) →
     kirim keluar (sign) → lock/unlock kecil.

### Tahap B — EXTERNAL_WALLET_ENABLED=true

1. `EXTERNAL_WALLET_ENABLED=true` di `apps/api/.env` → `pm2 restart canquest-api`.
2. User BARU membuat wallet → OTP → **key ceremony** muncul → wallet lahir
   non-custodial. Verifikasi satu akun tes baru end-to-end.
3. Upgrade sisa akun wallet-lama (masing-masing via Settings, ~2 menit/user).
   Pantau: user tsb `walletKind='external'` + `backupVerifiedAt` terisi.

### Tahap C — M5 (hapus custodial)

Setelah SEMUA wallet-lama ter-upgrade (query di atas → 0 baris `custodial`):
jalankan cleanup M5 (onboarding lama dimatikan, docs, env) — runbook
terpisah setelah Tahap B selesai.

## Rollback

- **Flag OFF** kapan pun → user custodial & jalur lama kembali normal;
  user external TETAP external (party mereka permanen di chain — tidak
  bisa dan tidak perlu di-rollback).
- Migrasi bersifat additive (kolom baru saja) — aman.
- Rollback kode: `git revert` + redeploy; party external yang sudah
  terdaftar tetap valid (topology tidak tergantung versi kode).

## Known notes

- **Preapproval & user external**: enable preapproval TIDAK mungkin utk party
  external (terbukti MainNet, spike-m3c: `DAML_AUTHORIZATION_ERROR` —
  AmuletRules_CreateTransferPreapproval mewajibkan co-authorizer provider;
  interactive submission hanya membawa tanda tangan pemilik kunci). User
  external menerima transfer via offer + sign-accept (by design, paling
  murni non-custodial). Toggle preapproval di Settings tetap berlaku hanya
  utk user custodial (jalur lama).
- Party external TIDAK bisa di-submit custodial oleh server (terbukti M0)
  — rights `CanActAs` operator atas party external tidak memberi kuasa
  tanda tangan.
- Lock user external = self-held (lockHolder = party user) — setara untuk
  eligibility quest (dibaca per owner).
- Klaim quest user external selalu jalur fallback non-atomic (fee via
  sign browser + reward dari reward wallet platform).
- Settle atomik (mixed-signature operator+user dalam 1 tx) belum
  didukung interactive submission — tidak dipakai untuk external.
