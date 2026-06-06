# Panduan Testing DAML Contract — canquest-v4 v1.0.1

Test setiap fungsi satu per satu. Copy error lengkap dan kirim ke saya.

---

## Setup: Aktifkan Debug Log

Di VPS, tambahkan ke `apps/api/.env`:
```env
# Aktifkan verbose DAML logging
DAML_DEBUG=true
```

Lalu:
```bash
pm2 restart canquest-api
pm2 logs canquest-api --lines 0 | grep -E "(DAML|Canton|Ledger|SpinExecution|UserAccount|WalletReg|DailyCheck)"
```

---

## Fungsi 1: UserAccount — Buat Akun On-Chain

**Trigger:** User buat wallet pertama kali (menu Wallet → submit Party ID)

**Cara test:**
1. Login ke website
2. Buka menu **Wallet**
3. Masukkan invite code dan buat wallet
4. Cek log:

**Output SUKSES:**
```
[QuestLedgerService] UserAccount created: @username → partyId_prefix
[QuestLedgerService] WalletRegistration created: @username partyId=partyId_prefix
```

**Output GAGAL (kirim ke saya):**
```
[CantonLedgerService] createContract failed 500: {...}
[QuestLedgerService] Failed to create UserAccount: ...
```

---

## Fungsi 2: SpinExecution — Audit Trail Spin

**Trigger:** User klik Spin di halaman `/spin/daily`

**Cara test:**
1. Login ke website
2. Buka halaman **Spin**
3. Klik tombol Spin (pastikan punya cukup points)
4. Cek log:

**Output SUKSES:**
```
[SpinService] Spin: user=xxxxxxxx won="100 Points" type=points jobId=none
[QuestLedgerService] SpinExecution recorded: @username item="100 Points" type=points spinResultId=xxxxxxxx
```

**Output GAGAL (kirim ke saya — FULL error):**
```
[CantonLedgerService] createContract failed 500: {"code":"LEDGER_API_INTERNAL_ERROR","cause":"...FULL TEXT..."}
[SpinService] DAML SpinExecution errors: Failed to record SpinExecution: ...
```

> ⚠️ **Penting:** Kirim FULL error JSON, bukan yang terpotong!

---

## Fungsi 3: DailyCheckIn — Check-in Harian

**Trigger:** User submit task "Daily Check-in" di halaman Quest/Earn

**Cara test:**
1. Login ke website
2. Buka halaman **Earn** atau **Quest**
3. Klik task "Daily Check-in"
4. Cek log:

**Output SUKSES:**
```
[QuestLedgerService] DailyCheckIn recorded: @username date=2026-06-06 streak=1
```

**Output GAGAL:**
```
[QuestLedgerService] Daily check-in ledger: ...error...
```

---

## Fungsi 4: QuestCampaign — Buat Campaign (Admin)

**Trigger:** Admin buat quest campaign baru di `/admin/quest`

**Cara test (Admin):**
1. Login sebagai admin
2. Buka `/admin/quest`
3. Buat quest baru dengan reward type CC
4. Cek log:

**Output SUKSES:**
```
[QuestLedgerService] QuestCampaign created: campaignId kind=CC_FCFS quota=10
```

---

## Fungsi 5: ClaimFcfsSlot — Klaim FCFS

**Trigger:** User klaim reward CC FCFS di halaman campaign

**Cara test:**
1. Login ke website
2. Buka campaign dengan reward CC FCFS
3. Selesaikan semua task
4. Klik tombol **Claim Reward**
5. Bayar claim fee
6. Cek log:

**Output SUKSES:**
```
[QuestLedgerService] ClaimFcfsSlot: user=username campaign=contractId_prefix...
[QuestLedgerService] ConfirmFeePaid: claim=contractId_prefix... feeTx=txId_prefix
[QuestLedgerService] ConfirmRewardSent: claim=contractId_prefix... rewardTx=txId_prefix
```

---

## Cara Dapat Full Error Log

Di VPS, jalankan:
```bash
# Lihat semua log real-time
pm2 logs canquest-api --lines 100

# Filter hanya error DAML/Canton
pm2 logs canquest-api --lines 200 | grep -A 3 "WARN\|ERROR\|failed\|INTERNAL"

# Simpan log ke file untuk dikirim
pm2 logs canquest-api --lines 500 > /tmp/daml-errors.txt
cat /tmp/daml-errors.txt
```

---

## Checklist Test

Kirim hasil setiap test ke saya:

| # | Fungsi | Status | Error (jika ada) |
|---|--------|--------|-----------------|
| 1 | UserAccount (buat wallet) | ⬜ | |
| 2 | SpinExecution (spin) | ⬜ | |
| 3 | DailyCheckIn (check-in) | ⬜ | |
| 4 | QuestCampaign (admin buat quest) | ⬜ | |
| 5 | ClaimFcfsSlot (klaim reward) | ⬜ | |

---

## Info Penting: Fungsi DAML Bersifat Best-Effort

Semua fungsi DAML **tidak memblokir** fungsi utama website. Artinya:
- Jika DAML gagal → website tetap jalan normal
- Error DAML hanya muncul di log sebagai `WARN`
- User tidak merasakan dampak error DAML

Jadi test utama adalah: **apakah log menunjukkan sukses atau error?**
