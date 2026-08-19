# RUNBOOK — Upgrade canquest-v29 + Smoke Test MAINNET (Canton Network)

> Dokumen mandiri: bisa dijalankan tanpa konteks chat/sebelumnya.
> Berlaku: repo `can`, commit setelah `ee8c90b` (rename v31→v29 + version-pinning).
> Lingkungan: **mainnet Canton Network** (validator `canton.network.global`),
> participant 0.6.12, VPS produksi, LEDGER_AUTH_MODE=keycloak.

## 0. Konteks singkat (WAJIB dipahami dulu)

- Produksi jalan di paket **`canquest-v28`**. Paket baru **`canquest-v29`**
  (konsolidasi iterasi workspace v29–v31: FIX-8..15 + TransferInstructionV2).
- **Version-pinning sudah di backend**: quest lama (v28) tetap diklaim dengan
  template/payload v28; quest baru dibuat sebagai v29. Kolom penanda:
  `Quest.ledgerPackage` (null + ada `ledgerCampaignId` = v28 lama).
  → **TIDAK PERLU end-and-recreate campaign aktif.** Kedua paket berdampingan.
- Upload DAR = non-destruktif (hanya menambah paket di package store).
- `Settle` itu **atomic**: kalau payload salah → transaksi gagal utuh, TIDAK
  ADA CC berpindah. Failure mode canary = receipt PRE_SETTLE menganggang
  (bisa di-`Expire`) + jejak tx di explorer.
- Kill-switch tersedia: `QUEST_ATOMIC_SETTLE=false`, `QUEST_LEDGER_ENABLED=false`,
  `CLAIM_SESSION_LEDGER_ENABLED=false`.

## 1. Pre-flight (lokal, gratis, belum menyentuh mainnet)

```bash
cd packages/daml
daml test    # HARUS: test: ok, 120 transactions
daml build   # HARUS: .daml/dist/canquest-v29-1.0.0.dar

cd ../../apps/api
npm run build          # HARUS: sukses (prisma generate + nest build)
npx jest               # HARUS: 65/65
```

Cek env produksi (di VPS, `apps/api/.env`) — kunci yang WAJIB ada untuk v29:

```
CANTON_DAML_PACKAGE_NAME   # kosongkan / hapus → default #canquest-v29
CANTON_OPERATOR_PARTY_ID   # operator (atau fallback validator)
CANTON_VALIDATOR_PARTY_ID
CANTON_FEE_RECIPIENT_PARTY_ID   # treasury (QuestCampaign.trustedTreasury)
CANTON_REWARD_PARTY_ID          # reward wallet (trustedRewardWallet + co-controller Settle)
CANTON_DSO_PARTY_ID             # instrument admin Amulet (fee selalu CC)
CANTON_APP_PROVIDER_PARTY_ID    # opsional (FAR); kosong → fallback operator
```

Cek konektivitas dari VPS: `npm run canton:check`.

## 2. Upload DAR v29 ke participant mainnet

```bash
# Di VPS (atau lokal dgn LEDGER_API_URL participant produksi):
cd apps/api
node scripts/upload-daml-dar.cjs ../../packages/daml/.daml/dist/canquest-v29-1.0.0.dar
node scripts/verify-daml-package.cjs   # pastikan canquest-v29 muncul di daftar paket
```

Alternatif curl manual: lihat pola di `docs/RUNBOOK_DAML_V24_DEPLOY.md` §3
(endpoint `POST /v2/dars`).

⚠️ Upload hanya menambah paket — kontrak v28 aktif TIDAK tersentuh.
Jangan hapus/env-override `CANTON_DAML_PACKAGE_NAME` ke v28 (payload baru
tidak kompatibel v28).

## 3. Migrasi DB (dedupe + version-pinning)

```bash
cd apps/api
npx prisma migrate deploy
# Migration yang akan terpakai:
#   20260819120000_v29_dedupe_constraints  (3 unique index + 2 kolom eligibility)
#   20260819130000_v29_quest_ledger_package (kolom Quest.ledgerPackage)
```

Semua kolom nullable → aman untuk data existing (Postgres unique membolehkan
banyak NULL). Verifikasi: `npx prisma studio` atau query
`SELECT version FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3;`

## 4. Deploy backend

Deploy commit ini ke VPS sesuai proses biasa (pm2/systemd + build di VPS).
Setelah jalan, perhatikan log startup:

- `✅ Canton party check PASSED` (party config valid)
- TIDAK ada error `PARTY CONFIG MISSING`

## 5. Verifikasi regresi v28 (SEBELUM canary v29)

PENTING: pastikan quest v28 lama masih bisa diklaim normal.

1. Pilih 1 quest lama aktif (punya `ledgerCampaignId`, `ledgerPackage` NULL).
2. Klaim dengan akun test seperti biasa (dashboard/endpoint claim).
3. Log backend harus menunjukkan path v28:
   - `ClaimSlot:` sukses (template `#canquest-v28:Main:QuestCampaign` via
     version-pinning — cek tidak ada `WRONGLY_TYPED_CONTRACT`).
   - `Settle OK` (registry v1 — jalur lama).
4. Kalau GAGAL → STOP. Set `QUEST_ATOMIC_SETTLE=false` (fallback non-atomic),
   investigasi, jangan lanjut canary.

## 6. Campaign canary v29

Buat via dashboard admin (proses sama seperti biasa):

- rewardType: **CC_ONLY** (paling sedikit moving parts)
- maxWinners: **2** (1 slot sukses + 1 slot uji penolakan amount)
- rewardCc: **kecil** (mis. 1 CC) — dana reward wallet nyata
- claimFeeCc: biarkan kosong (default 3) — user test bayar fee nyata
- entryGateMode: **NONE** (uji auto-issued POINTS proof dulu),
  lalu ulangi dengan CC_ONLY bila ingin uji jalur CoinLock+lockCid.

Setelah dibuat, verifikasi:

```sql
-- quest baru harus mencatat versi paket:
SELECT id, "ledgerCampaignId", "ledgerPackage" FROM "Quest"
ORDER BY "createdAt" DESC LIMIT 1;
-- HARUS: ledgerCampaignId terisi, ledgerPackage = 'canquest-v29'
```

Log backend: `QuestCampaign created (v29): ... kind=CC_FCFS ... fee=3`.

## 7. Checklist smoke (akun test, satu per satu)

Jalankan berurutan; catat hasil tiap butir (✅/❌ + tx id).

| # | Uji | Cara | Hasil diharapkan |
|---|-----|------|------------------|
| 1 | Claim FCFS → Settle happy | Klaim slot-1 dari UI | Receipt SETTLED: fee (3 CC) user→treasury sampai; reward (1 CC) reward-wallet→user sampai; `winnerDraw.distributed=true`; `ledgerTxId` terisi; explorer Modo (`https://cc.modo.link/mainnet/event/<updateId>%3A0`) menunjukkan tx |
| 2 | Registry v2 + Account | (implisit dari #1) | Tidak ada error `registry/transfer-instruction/v2`; log `Settle OK ... reward=true` |
| 3 | Penolakan amount salah | Coba manipulasi amount (perlu DEBUG build / langsung cek guard via tx gagal) | Settle DITOLAK on-chain (`Fee amount tidak sesuai kontrak!`) — atomic, tidak ada dana bergerak |
| 4 | RecordTxId + activity | Cek receipt/log setelah #1 | `RecordTxId OK` di log; receipt feeTxId terisi |
| 5 | Quest kedua jenis CODE | Klaim quest kode (undangan) existing v28 ATAU buat canary CODE_FCFS kecil | `RevealCode` sukses; kode terlihat user; (v29 DrawWinner rewardCode → null bila tanpa kode) |
| 6 | Jalur LOCK_CC + CoinLock | Buat canary CC_ONLY + entryGateMode CC_ONLY; akun test lock CC dulu; klaim | Log: `CoinLock created (v29)`; `ClaimSlot OK`; Settle sukses; `CampaignEligibilityLedger.lockId/coinLockCid` terisi |
| 7 | Dedupe double-claim | Klaim ulang quest sama dgn akun sama | Ditolak app (WinnerDraw unique / already_claimed); TIDAK ada receipt kedua on-chain |
| 8 | Regresi wallet | User test lama (sudah punya WalletRegistration v28) login & buka wallet | TIDAK ada registrasi duplikat (idempotensi dual-version) |

## 8. Kalau MERAH (rollback / mitigasi)

- **Segera**: `QUEST_ATOMIC_SETTLE=false` (fallback non-atomic) atau
  `QUEST_LEDGER_ENABLED=false` + `CLAIM_SESSION_LEDGER_ENABLED=false`
  (matikan semua tulis ledger) → restart API.
- END campaign canary via dashboard (status ENDED → ClaimSlot ditolak kontrak).
- Receipt PRE_SETTLE menganggang: exercise `Expire` (controller admin) via
  JSON API, atau biarkan (tidak berbahaya, hanya storage).
- Dana TIDAK bisa hilang setengah jalan (atomic). Fee yang sudah masuk
  treasury dari klaim sukses tidak dikembalikan (nilai kecil, catat saja).
- Kumpulkan: log backend lengkap + `updateId`/error ledger → lanjut debug.

## 9. Kriteria HIJAU (sign-off Langkah 3)

- Butir #1–#4 dan #7–#8 ✅ (inti wajib).
- #6 ✅ bila LOCK_CC akan dipakai campaign berikutnya; #5 ✅ bila quest kode dipakai.
- Tidak ada error `WRONGLY_TYPED_CONTRACT` / `COMMAND_PREPROCESSING` tersisa.
- Regresi v28 (§5) ✅.

Setelah hijau: buka campaign asli v29 (deploy publik = Langkah 4 runbook deploy).

## 10. Catatan teknis penting

- Reward non-CC (USDCx) TIDAK lewat Settle v29 (instrument dipin Amulet);
  jalur delivery token terpisah tetap berlaku — jangan uji USDCx di canary ini.
- Timestamp on-chain v29 = Zulu detik-presisi (`YYYY-MM-DDTHH:MM:SSZ`);
  quest v28 tetap format lama (ms) — per-quest konsisten, tidak dicampur.
- `durationDays` CoinLock hanya 3/7/15 → term 30d dipetakan 15d (expiresAt
  asli dipertahankan). Kalau campaign LOCK_CC butuh presisi term, samakan
  `LOCK_TERM_OPTIONS` dengan 3/7/15 dulu.
- Registry v2 = `ExternalPartyAmuletRules` (splice 0.6.12). Transfer V2
  wajib ≥1 inputHoldingCids dan meta tanpa info akun — backend sudah
  menyesuaikan.
