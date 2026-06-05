# CanQuest DAML Contracts Documentation
## Package: `canquest-v4` | SDK: 3.4.11 | Version: 1.0.0

---

## Overview

Semua transaksi penting di CanQuest dicatat on-chain di Canton Network menggunakan DAML smart contracts. Ini memastikan:

- **Tidak ada manipulasi** — semua choice hanya bisa dieksekusi oleh admin/operator
- **Audit trail permanen** — setiap transaksi tercatat di ledger Canton
- **Kuota FCFS divalidasi on-chain** — jika slot penuh, transaksi otomatis GAGAL dan di-revert
- **Fee verification** — reward tidak bisa dikirim tanpa bukti fee diterima
- **Anti double-spend** — setiap spin/check-in punya ID unik

### Authorization Pattern (Canton M3)
```
signatory admin  ← operator yang menandatangani semua kontrak
observer user    ← user hanya bisa melihat, tidak bisa submit sendiri
```

---

## Templates

### 1. `UserAccount`
**File:** `packages/daml/daml/Main.daml`

Akun user on-chain yang menyimpan total poin earned dan spent.

| Field | Type | Keterangan |
|-------|------|-----------|
| `admin` | Party | Operator CanQuest |
| `userAddress` | Party | Canton Party ID user |
| `username` | Text | Username di platform |
| `earnedPoints` | Int | Total poin yang pernah diraih |
| `spentPoints` | Int | Total poin yang sudah dipakai untuk spin |
| `createdAt` | Text | ISO timestamp pembuatan |

**Choices:**
- `RewardPoints` — tambah poin (quest, spin win, check-in, referral)
- `DebitPoints` — kurangi poin untuk spin (validasi: available >= amount)
- `UpdateUsername` — update username

**Kapan dibuat:** Saat user register dan membuat wallet pertama kali.

---

### 2. `WalletRegistration`
**File:** `packages/daml/daml/Main.daml`

Bukti on-chain bahwa user telah membuat wallet dengan Party ID yang sah.

| Field | Type | Keterangan |
|-------|------|-----------|
| `admin` | Party | Operator CanQuest |
| `userAddress` | Party | Canton Party ID user |
| `username` | Text | Username di platform |
| `partyId` | Text | Party ID string |
| `inviteCode` | Text | Kode invite yang dipakai |
| `registeredAt` | Text | ISO timestamp registrasi |

**Choices:**
- `ConfirmWalletActive` — konfirmasi wallet aktif di Canton Network

**Kapan dibuat:** Saat user submit Party ID (dari admin invite code) di menu Wallet.

---

### 3. `QuestCampaign`
**File:** `packages/daml/daml/Main.daml`

Template induk untuk semua jenis quest campaign. Mencakup 4 type.

| Field | Type | Keterangan |
|-------|------|-----------|
| `admin` | Party | Operator CanQuest |
| `campaignId` | Text | ID campaign dari DB |
| `title` | Text | Judul campaign |
| `questKind` | Text | `CC_FCFS` \| `CC_RAFFLE` \| `CODE_FCFS` \| `CODE_RAFFLE` |
| `rewardCc` | Decimal | Jumlah CC reward per pemenang |
| `claimFeeCc` | Decimal | Biaya claim fee CC |
| `maxWinners` | Int | Kuota maksimal (0 = unlimited) |
| `currentClaims` | Int | Jumlah klaim yang sudah terjadi |
| `status` | Text | `ACTIVE` \| `ENDED` \| `CLOSED` |
| `createdAt` | Text | ISO timestamp pembuatan |

**Choices:**
- `ClaimFcfsSlot` — reserve slot FCFS (validasi kuota on-chain, GAGAL jika penuh)
- `DrawRaffleWinner` — catat pemenang raffle yang dipilih admin
- `CloseCampaign` — tutup campaign

**Kapan dibuat:** Saat admin membuat quest campaign baru.

---

### 4. `QuestClaim`
**File:** `packages/daml/daml/Main.daml`

Bukti on-chain bahwa user telah mengklaim quest campaign.

| Field | Type | Keterangan |
|-------|------|-----------|
| `admin` | Party | Operator CanQuest |
| `userAddress` | Party | Canton Party ID user |
| `campaignId` | Text | ID campaign dari DB |
| `claimId` | Text | ID unik klaim (anti double-claim) |
| `claimKind` | Text | `CC_FCFS` \| `CC_RAFFLE` \| `CODE_FCFS` \| `CODE_RAFFLE` |
| `rewardCc` | Decimal | Jumlah CC reward |
| `rewardCode` | Text | Kode reward (untuk CODE_*) |
| `claimFeeCc` | Decimal | Biaya claim fee CC |
| `feePaid` | Bool | Apakah fee sudah dibayar |
| `feeTxId` | Text | Splice TX ID bukti fee |
| `rewardSent` | Bool | Apakah reward sudah dikirim |
| `rewardTxId` | Text | Splice TX ID bukti reward |
| `claimedAt` | Text | ISO timestamp klaim |

**Choices:**
- `ConfirmFeePaid` — konfirmasi fee CC diterima (WAJIB sebelum reward)
- `ConfirmRewardSent` — konfirmasi reward dikirim (fee harus dibayar dulu)

**Flow:** `ClaimFcfsSlot/DrawRaffleWinner` → `QuestClaim` dibuat → `ConfirmFeePaid` → `ConfirmRewardSent`

---

### 5. `DailyCheckIn`
**File:** `packages/daml/daml/Main.daml`

Bukti on-chain bahwa user telah melakukan check-in harian.

| Field | Type | Keterangan |
|-------|------|-----------|
| `admin` | Party | Operator CanQuest |
| `userAddress` | Party | Canton Party ID user |
| `username` | Text | Username di platform |
| `checkInId` | Text | ID unik: `{userId}_{YYYY-MM-DD}` |
| `checkInDate` | Text | Tanggal check-in `YYYY-MM-DD` |
| `pointsAwarded` | Int | Poin yang diberikan |
| `streakCount` | Int | Streak hari berturut-turut |
| `checkedInAt` | Text | ISO timestamp check-in |

**Choices:**
- `VerifyCheckIn` — verifikasi check-in sudah diproses (opsional, untuk audit)

**Kapan dibuat:** Setiap kali user melakukan daily check-in di menu Quest.

---

### 6. `SpinExecution`
**File:** `packages/daml/daml/Main.daml`

Bukti on-chain bahwa satu putaran spin telah dieksekusi.

| Field | Type | Keterangan |
|-------|------|-----------|
| `admin` | Party | Operator CanQuest |
| `userAddress` | Party | Canton Party ID user |
| `username` | Text | Username di platform |
| `spinResultId` | Text | ID unik dari DB (anti double-spend) |
| `spinItemId` | Text | ID item yang menang |
| `spinItemLabel` | Text | Label item (e.g. "50 CC", "100 Points") |
| `rewardType` | Text | `cc` \| `points` \| `none` |
| `rewardCc` | Decimal | Jumlah CC (0.0 jika bukan CC) |
| `rewardPoints` | Int | Jumlah points (0 jika bukan points) |
| `spinCost` | Int | Poin yang dipakai untuk spin |
| `executedAt` | Text | ISO timestamp eksekusi |

**Choices:**
- `ConfirmCcDelivered` — konfirmasi CC reward sudah dikirim via Splice → membuat `SpinCcReward`

**Kapan dibuat:** Setiap kali user melakukan spin di menu Spin.

---

### 7. `SpinCcReward`
**File:** `packages/daml/daml/Main.daml`

Bukti on-chain bahwa CC reward dari spin sudah dikirim ke user.

| Field | Type | Keterangan |
|-------|------|-----------|
| `admin` | Party | Operator CanQuest |
| `userAddress` | Party | Canton Party ID user |
| `username` | Text | Username di platform |
| `spinResultId` | Text | Referensi ke SpinExecution |
| `rewardCc` | Decimal | Jumlah CC yang dikirim |
| `spliceTxId` | Text | Canton/Splice TX ID sebagai bukti |
| `deliveredAt` | Text | ISO timestamp pengiriman CC |

**Kapan dibuat:** Dibuat oleh `ConfirmCcDelivered` setelah Splice TX berhasil.

---

## Mapping Fitur Web → DAML Contract

| Fitur Web | DAML Contract | Method di Service |
|-----------|--------------|-------------------|
| Register + buat wallet | `UserAccount` + `WalletRegistration` | `ensureUserAccount()` + `registerWallet()` |
| Wallet: submit Party ID | `WalletRegistration` | `registerWallet()` |
| Quest CC FCFS: klaim | `QuestCampaign.ClaimFcfsSlot` → `QuestClaim` | `claimFcfsSlot()` |
| Quest CC FCFS: bayar fee | `QuestClaim.ConfirmFeePaid` | `confirmFeePaid()` |
| Quest CC FCFS: terima reward | `QuestClaim.ConfirmRewardSent` | `confirmRewardSent()` |
| Quest CC Raffle: admin draw | `QuestCampaign.DrawRaffleWinner` → `QuestClaim` | `drawRaffleWinner()` |
| Quest Code FCFS: klaim | `QuestCampaign.ClaimFcfsSlot` → `QuestClaim` | `claimFcfsSlot()` |
| Quest Code Raffle: admin draw | `QuestCampaign.DrawRaffleWinner` → `QuestClaim` | `drawRaffleWinner()` |
| Daily Check-in | `DailyCheckIn` | `recordDailyCheckIn()` |
| Spin: eksekusi | `SpinExecution` | `recordSpinExecution()` |
| Spin: CC reward dikirim | `SpinCcReward` | `confirmSpinCcDelivered()` |
| Quest selesai: dapat poin | `UserAccount.RewardPoints` | `rewardUser()` |
| Spin: debit poin | `UserAccount.DebitPoints` | `debitPoints()` |

---

## Build & Deploy

### Build di VPS (Linux)

```bash
# 1. Pastikan DAML SDK 3.4.11 terinstall
curl -sSL https://get.daml.com/ | sh -s 3.4.11

# 2. Build dan test
bash scripts/daml-build-vps.sh

# 3. Upload DAR ke Canton ledger
cd apps/api
node scripts/upload-daml-dar.cjs

# 4. Update .env
CANTON_DAML_PACKAGE_NAME=canquest-v4
CANTON_DAML_PACKAGE_ID=<package-id-dari-step-2>

# 5. Restart API
pm2 restart canquest-api
```

### Build via Docker (Windows)

```powershell
# Pastikan Docker Desktop berjalan
.\scripts\daml-build-test.ps1
```

### DAR Output
```
packages/daml/.daml/dist/canquest-v4-1.0.0.dar
```

---

## Test Coverage

File: `packages/daml/daml/Test.daml`

| Section | Test Cases |
|---------|-----------|
| [A] UserAccount | RewardPoints, DebitPoints, UpdateUsername, validasi error |
| [B] WalletRegistration | ConfirmWalletActive, validasi error |
| [C] QuestCampaign CC_FCFS | ClaimFcfsSlot, kuota habis, CloseCampaign |
| [D] QuestCampaign CODE_FCFS | ClaimFcfsSlot dengan code, kuota habis |
| [E] QuestCampaign CC_RAFFLE | DrawRaffleWinner multiple winners |
| [F] QuestCampaign CODE_RAFFLE | DrawRaffleWinner dengan code |
| [G] QuestClaim | ConfirmFeePaid, ConfirmRewardSent, urutan wajib, double-pay/send |
| [H] DailyCheckIn | VerifyCheckIn, validasi error |
| [I] SpinExecution | ConfirmCcDelivered, validasi rewardType |
| [J] Edge Cases | Cross-type errors, security validations |

**Total test cases: 30+**

Jalankan test:
```bash
# Di VPS
cd packages/daml
~/.daml/bin/daml test

# Via Docker (Windows)
.\scripts\daml-build-test.ps1
```

---

## Environment Variables

```env
# Aktifkan DAML ledger writes
QUEST_LEDGER_ENABLED=true
CLAIM_SESSION_LEDGER_ENABLED=true

# Canton operator party
CANTON_OPERATOR_PARTY_ID=<operator-party-id>

# Package reference (setelah upload DAR)
CANTON_DAML_PACKAGE_NAME=canquest-v4
CANTON_DAML_PACKAGE_ID=<64-char-hex-package-id>
```

---

## Perubahan dari canquest-v3

| Aspek | canquest-v3 | canquest-v4 |
|-------|------------|------------|
| Templates | 4 (UserAccount, Mission, SpinExecution, SpinCcReward) | 7 (+ WalletRegistration, QuestCampaign, QuestClaim, DailyCheckIn) |
| Quest types | Hanya FCFS | CC_FCFS, CC_RAFFLE, CODE_FCFS, CODE_RAFFLE |
| Wallet registration | Tidak ada | ✅ WalletRegistration contract |
| Daily check-in | Tidak ada | ✅ DailyCheckIn contract |
| Fee verification | Tidak ada | ✅ ConfirmFeePaid wajib sebelum reward |
| Raffle support | Tidak ada | ✅ DrawRaffleWinner |
| Konsistensi DAR | ❌ Inkonsisten (totalPoints vs earnedPoints) | ✅ Konsisten |
| No-op stubs | Banyak | Minimal (hanya legacy compat) |
