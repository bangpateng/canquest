# DAML Contracts Documentation — CanQuest v0.2.0

## Overview

Dokumen ini menjelaskan DAML contracts yang diimplementasikan untuk platform CanQuest.
Contract menggunakan **module Main** (satu file) dengan 3 template utama.

**File contract:** [`packages/daml/daml/Main.daml`](../packages/daml/daml/Main.daml)  
**Package:** `canquest-v2` v0.2.0  
**SDK:** `3.3.0-snapshot.20250930.0`  
**Test:** `testFullWorkflow` — 10 skenario, semua harus PASS

---

## Arsitektur Contract

```
packages/daml/
├── daml.yaml          ← SDK version, package name, version
└── daml/
    └── Main.daml      ← Semua template dalam satu file
        ├── UserAccount      (template 1)
        ├── Mission          (template 2)
        └── DailyLuckySpin   (template 3)
```

### Authorization Pattern (Canton M3)

```
signatory admin     ← operator platform — menandatangani semua kontrak
observer  user      ← user hanya bisa melihat, tidak bisa submit sendiri
```

Backend (NestJS API di VPS 2) submit semua command sebagai `admin` (operator party).
User hanya menjadi observer — mereka bisa melihat kontrak mereka di ledger.

---

## Template 1: UserAccount

**Fungsi:** Menyimpan akun user dengan total poin yang dikumpulkan.

```daml
template UserAccount
  with
    admin        : Party   -- operator platform
    userAddress  : Party   -- wallet address / party user
    username     : Text    -- nama tampilan user
    totalPoints  : Int     -- total poin yang dikumpulkan
```

**Contract Key:** `(admin, userAddress) : (Party, Party)`  
→ Satu user hanya punya satu akun per admin (idempoten).

**Choices:**
| Choice | Controller | Fungsi |
|--------|-----------|--------|
| `RewardUser` | admin | Tambah poin ke akun user |

**Validasi di RewardUser:**
- `pointsToAdd > 0` — tidak boleh tambah 0 atau negatif

**Dipanggil dari API:**
- `QuestLedgerService.ensureUserAccount()` — saat user register/buat wallet
- `QuestLedgerService.rewardUser()` — setelah quest selesai / spin / klaim misi

---

## Template 2: Mission

**Fungsi:** Misi FCFS (First Come First Served) dengan kuota terbatas.

```daml
template Mission
  with
    admin         : Party  -- operator platform
    missionId     : Text   -- ID unik misi
    rewardPoints  : Int    -- poin per klaim
    maxQuota      : Int    -- kuota maksimal pemenang
    currentClaims : Int    -- jumlah klaim yang sudah terjadi
```

**Contract Key:** `(admin, missionId) : (Party, Text)`  
⚠️ **PENTING:** Key type adalah `(Party, Text)` — bukan `(Party, Party)` karena `missionId` bertipe `Text`.

**Choices:**
| Choice | Controller | Fungsi |
|--------|-----------|--------|
| `ClaimMission` | admin | Klaim slot FCFS, update counter |

**Validasi di ClaimMission:**
- `currentClaims < maxQuota` — tolak jika kuota sudah habis
- Mengembalikan `(ContractId Mission, ContractId UserAccount)` — keduanya diperbarui

**Dipanggil dari API:**
- `QuestLedgerService.createMission()` — saat admin buat campaign baru
- `QuestLedgerService.claimMission()` — saat user klaim reward FCFS

---

## Template 3: DailyLuckySpin

**Fungsi:** Sistem spin harian — user hanya boleh spin 1x per hari.

```daml
template DailyLuckySpin
  with
    admin        : Party  -- operator platform
    userAddress  : Party  -- user yang memiliki spin ini
    lastSpinDate : Date   -- tanggal terakhir user melakukan spin
```

**Contract Key:** `(admin, userAddress) : (Party, Party)`  
→ Satu spin record per user per admin.

**Choices:**
| Choice | Controller | Fungsi |
|--------|-----------|--------|
| `ExecuteSpin` | admin | Eksekusi spin, update tanggal |

**Validasi di ExecuteSpin:**
- `currentDate /= lastSpinDate` — tolak jika sudah spin hari ini
- `spinReward > 0` — reward harus positif

**Dipanggil dari API:**
- `QuestLedgerService.ensureDailySpinContract()` — saat user pertama kali akses spin
- `QuestLedgerService.executeDailySpin()` — saat user klik tombol spin

---

## Test Suite (testFullWorkflow)

File: `packages/daml/daml/Main.daml` — fungsi `testFullWorkflow`

| # | Skenario | Expected |
|---|----------|----------|
| b | Buat akun Budi & Iwan | ✅ SUKSES |
| c | Admin buat Misi FCFS kuota=1 | ✅ SUKSES |
| d | Budi klaim misi pertama | ✅ SUKSES |
| e | Iwan klaim misi yang sama (kuota habis) | ❌ GAGAL (assertMsg) |
| f | Setup DailyLuckySpin untuk Budi (1 Mei) | ✅ SUKSES |
| g | Budi spin di hari baru (2 Mei) | ✅ SUKSES |
| h | Budi spin lagi di hari yang sama (2 Mei) | ❌ GAGAL (assertMsg) |
| i | Budi spin di hari berikutnya (3 Mei) | ✅ SUKSES |
| j | RewardUser dengan pointsToAdd=0 | ❌ GAGAL (assertMsg) |

---

## Build & Deploy

### 1. Build .dar (di Local PC)

```powershell
cd packages\daml
dpm install package          # Install SDK dari daml.yaml
dpm build                    # Output: .daml/dist/canquest-v2-0.2.0.dar
dpm test                     # Jalankan testFullWorkflow — semua harus PASS
```

### 2. Ambil Package ID

```powershell
dpm damlc inspect .daml\dist\canquest-v2-0.2.0.dar --json | findstr packageId
```

### 3. Upload ke Canton Participant (VPS 1)

Tunnel harus hidup dulu:
```powershell
# Terminal 1 (biarkan hidup):
ssh -N -L 7575:172.18.0.5:7575 -L 8080:172.18.0.7:80 root@162.250.190.204

# Terminal 2 (upload):
curl -X POST `
  -H "Authorization: Bearer <JWT_TOKEN>" `
  -H "Content-Type: application/octet-stream" `
  --data-binary @packages\daml\.daml\dist\canquest-v2-0.2.0.dar `
  http://127.0.0.1:7575/v1/packages
```

### 4. Update `.env` di VPS 2

```env
CANTON_DAML_PACKAGE_NAME=canquest-v2
CANTON_DAML_PACKAGE_ID=<64-hex dari dpm build>
CANTON_OPERATOR_PARTY_ID=<dari node scripts/ensure-quest-operator.cjs>
QUEST_LEDGER_ENABLED=true
CLAIM_SESSION_LEDGER_ENABLED=true
```

### 5. Restart API

```bash
pm2 restart canquest-api
pm2 logs canquest-api | grep -E "UserAccount|Mission|DailyLuckySpin"
```

---

## Template IDs (JSON Ledger API)

Setelah deploy, template direferensikan sebagai:

```
#canquest-v2:Main:UserAccount
#canquest-v2:Main:Mission
#canquest-v2:Main:DailyLuckySpin
```

Atau dengan package hash ID:
```
<packageId>:Main:UserAccount
<packageId>:Main:Mission
<packageId>:Main:DailyLuckySpin
```

---

## API Integration

| Event | DAML Action | Method |
|-------|-------------|--------|
| User register / buat wallet | Buat `UserAccount` | `ensureUserAccount()` |
| Quest selesai / reward | Exercise `RewardUser` | `rewardUser()` |
| Admin buat campaign FCFS | Buat `Mission` | `createMission()` |
| User klaim FCFS | Exercise `ClaimMission` | `claimMission()` |
| User pertama kali spin | Buat `DailyLuckySpin` | `ensureDailySpinContract()` |
| User klik spin | Exercise `ExecuteSpin` | `executeDailySpin()` |

---

## Bug Fixes dari Versi Sebelumnya

| Bug | Versi Lama | Versi Baru (v0.2.0) |
|-----|-----------|---------------------|
| Mission key type salah | `key (admin, missionId) : (Party, Party)` | `key (admin, missionId) : (Party, Text)` |
| Tidak ada validasi RewardUser | Bisa tambah 0 poin | `assertMsg (pointsToAdd > 0)` |
| Import tidak perlu | `import DA.Time` (tidak dipakai) | Hanya `import DA.Date` |
| Module terfragmentasi | 10+ file di CanQuest.* | Satu file `Main.daml` |

---

## References

- [DAML Documentation](https://docs.daml.com/)
- [Canton Network M3 Dev Environment](https://docs.canton.network/appdev/modules/m3-dev-environment)
- [Canton Network M4 Building Apps](https://docs.canton.network/appdev/modules/m4-building-apps-intro)
- [DAML SDK Setup Guide](./DAML_SDK_SETUP.md)
- [Canton TestNet Guide](./CANTON_TESTNET.md)
