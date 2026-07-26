# USDCx Reward Token — Setup & Operasi

> Campaign reward sekarang bisa pakai **USDCx** (selain CC/Amulet).
> Fitur: per-campaign `rewardToken` ("CC" default | "USDCx"). Fee claim tetap CC.

---

## Cara kerja (singkat)

- Admin pilih token reward per-campaign saat buat/edit quest (CC atau USDCx).
- **USDCx didukung untuk semua reward type yang berdistribusi token**:
  - `CC_ONLY` (FCFS) — slot limit, first-come.
  - `CC_MANUAL` (Raffle CC) — admin draw winners, user claim.
  - `CC_AND_CODE_RAFFLE` (Raffle dual) — bayar fee → dapat token + kode.
- Saat user klaim: reward di-**transfer on-chain** dari reward wallet (`CANTON_REWARD_PARTY_ID`) ke wallet user.
- **Realtime behavior** (sama kayak CC yang sudah ada):
  - User **aktif** TransferPreapproval → reward langsung masuk wallet (direct). UI tampilkan badge "✓ Sent to your wallet".
  - User **belum aktif** → reward masuk **Offer** (pending di inbox wallet). UI tampilkan badge "⏳ Accept in Wallet inbox" + link `/wallet`.
- Claim fee tetap **CC** (default 3 CC) untuk semua token.
- **Logo token**: CC & USDCx di-serve dari R2 via `/api/uploads/token-logo/{CC,USDCx}` (sama dgn wallet). Component `RewardTokenLogo` menangani fallback gradient.

---

## ⚠️ YANG WAJIB ANDA LAKUKAN SEBELUM USDCx CAMPAIGN LIVE

### 1. Top-up reward wallet dengan USDCx

Wallet reward = `CANTON_REWARD_PARTY_ID` (canquest-reward-user) — **wallet yang sama** dengan CC reward.
Wallet ini harus **dipegang USDCx** sebelum ada campaign USDCx di-claim. Kalau tidak, klaim akan gagal dengan error:
`Reward wallet too low for USDCx (... has X USDCx, need Y USDCx). Top-up reward wallet first.`

Cara top-up (di VPS Canton CLI):
```bash
# Contoh: transfer USDCx dari wallet operasional Anda ke reward wallet
# (sesuaikan command Canton CLI dengan setup node Anda)
canton> transfer USDCx --from <your-ops-party> --to $CANTON_REWARD_PARTY_ID --amount <N>
```

Cek saldo USDCx reward wallet:
```bash
# Via API health endpoint atau ledger query
curl http://localhost:3001/api/admin/stats  # cek reward wallet balance
```

### 2. Jalankan DB migration di Supabase production

Migration file: `apps/api/prisma/migrations/20260725120000_add_reward_token/migration.sql`

**Penting**: PostgreSQL **tidak bisa** `ALTER TYPE ... ADD VALUE` dalam transaksi yang sama dengan `ALTER TABLE`. Jalankan **per-statement** (bukan sebagai 1 batch transaksi):

```sql
-- Statement 1-4 (ALTER TABLE, bisa batch)
ALTER TABLE "Quest" ADD COLUMN "rewardToken" TEXT NOT NULL DEFAULT 'CC';
ALTER TABLE "WinnerDraw" ADD COLUMN "rewardToken" TEXT NOT NULL DEFAULT 'CC';
ALTER TABLE "QuestCompletion" ADD COLUMN "rewardToken" TEXT NOT NULL DEFAULT 'CC';
ALTER TABLE "QuestCompletion" ADD COLUMN "rewardTokenAmount" DECIMAL(38,18);

-- Statement 5 (ALTER TYPE — HARUS dijalankan terpisah, di luar transaksi)
ALTER TYPE "TokenTxType" ADD VALUE 'QUEST_REWARD';
```

Di Supabase dashboard: SQL Editor → jalankan statement 1-4 dulu (commit), lalu statement 5.

**Verifikasi**:
```sql
SELECT "rewardToken" FROM "Quest" LIMIT 1;  -- harus return 'CC' (default)
SELECT enum_range(NULL::"TokenTxType");      -- harus include 'QUEST_REWARD'
```

Default "CC" → semua quest existing **tidak berubah behavior** (backward-compat).

### 3. Deploy

- **VPS API**: `git pull origin master && npm run build && pm2 restart canquest-api --update-env`
- **Vercel web**: auto-deploy saat push master
- **Supabase**: sudah di-migrate (langkah 2)

### 4. Test di staging dulu

Sebelum buka ke production user:
1. Buat campaign USDCx di admin (reward token = USDCx).
2. Pastikan reward wallet staging punya USDCx.
3. Klaim sebagai test user → cek:
   - User dgn preapproval aktif → USDCx langsung masuk wallet.
   - User tanpa preapproval → USDCx muncul di Wallet → Offers (pending).

---

## Env yang dipakai (sudah ada, tidak ada var baru)

| Env | Fungsi |
|---|---|
| `CANTON_REWARD_PARTY_ID` | Party ID wallet reward (CC + USDCx). |
| `CANTON_REWARD_API_USER` | Username wallet reward (utk cek saldo CC via splice). |
| `CANTON_DSO_PARTY_ID` | Admin party Amulet/CC (utk instrumentAdmin CC). |
| `CANTON_VALIDATOR_PARTY_ID` | Validator fallback. |
| `CANTON_FEE_RECIPIENT_PARTY_ID` | Penerima claim fee (CC). |

USDCx `instrumentAdmin` di-resolve dinamis via **OneSwap `listTokens()`** (cache 60s) — tidak perlu env.

---

## Monitoring

- **Saldo USDCx reward wallet**: cek via `getTokenBalanceOnChain(rewardPartyId, 'USDCx')`.
- **History reward USDCx**: di tabel `TokenTransaction` dgn `type = 'QUEST_REWARD'` (bukan `CcTransaction`).
- **Log claim**: cari `Raffle reward` / `FCFS reward` / `CC+Code raffle reward` dgn token USDCx di `pm2 logs canquest-api`.

---

## Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `Reward wallet too low for USDCx` | Wallet reward belum di-fund USDCx | Top-up USDCx ke `CANTON_REWARD_PARTY_ID` |
| `Token symbol "USDCx" not found in OneSwap tokens` | OneSwap API down / token belum listed | Cek koneksi OneSwap; pastikan USDCx listed |
| User bilang reward tidak masuk | User belum aktifkan TransferPreapproval → reward pending di Offer | Minta user cek Wallet → Offers, atau aktifkan Pre-Approval |
| Claim CC error padahal reward CC | (regresi) cek `assertRewardPool` token='CC' jalan normal | Default CC tidak berubah behavior |

---

## Catatan teknis

- **DAML receipt** (`atomicFeeAndReward`): tetap CC-only (fee CC + reward proof). USDCx proof hanya di Postgres (`TokenTransaction`). Tidak perlu ubah DAML template.
- **USDCx + CC_MANUAL (Raffle)**: Didukung penuh. CC_MANUAL = user-facing claim (`claimDrawCcReward` via `POST /quests/:id/claim-draw-cc`), BUKAN admin bulk distribute. Method itu sudah token-aware via `sendQuestRewardAndRecord` helper. Admin bulk distribute (`distributeRewards`) tetap CC-only — tapi itu hanya dipakai untuk reward type lain (mis. distribution manual lama), bukan CC_MANUAL.
- **Reward delivery status**: Response claim (FCFS/draw/raffle) expose `rewardDelivery: "direct" | "pending_offer"` (derived dari `sendReward` return `pending`). FE tampilkan badge sesuai status. Tidak perlu kolom DB baru (info hanya relevan di momen claim).
- **Decimals**: USDCx pakai `Decimal(38,18)` (kolom `rewardTokenAmount`), CC pakai `BigInt micro-CC` (`rewardMicroCc`). Tidak di-overload.
- **Realtime**: tidak ada mekanisme auto-accept baru. Behavior = identik CC (direct/offer sesuai preapproval).
- **Logo**: `RewardTokenLogo` component (FE) render dari `/api/uploads/token-logo/{symbol}`. Backend R2 case-insensitive. Fallback gradient + initial letter kalau asset 404.
- **Invite codes one-shot**: Form create quest punya textarea codes (muncul untuk reward type invite/dual). Saat submit: POST quest → POST codes (chaining, non-fatal kalau gagal).
