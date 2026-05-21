# CanQuest — Opsi B: CIP-56 & TransferPreapproval (Canton Coin)

Panduan operasional untuk dApp CanQuest yang mengikuti **kebijakan Canton Network**:
terima CC dengan **TransferPreapproval**, kirim reward lewat validator, dan kumpulkan **app reward** (Featured App Activity).

Referensi resmi:
- [Canton Coin Preapprovals (Module 7)](https://docs.canton.network/appdev/modules/m7-canton-coin-preapprovals)
- [Featured App Activity (Module 4)](https://docs.canton.network/appdev/modules/m4-featured-app-activity-marker)
- [App Rewards](https://docs.canton.network/appdev/app-rewards)
- [CIP-56](https://github.com/global-synchronizer-foundation/cips/blob/main/cip-0056/cip-0056.md)

---

## Opsi A vs Opsi B

| | Opsi A — Transfer Offer | Opsi B — TransferPreapproval (pilihan kamu) |
|---|-------------------------|---------------------------------------------|
| Alur | Buat offer → penerima **wajib Accept** | Penerima sudah setuju di on-chain → kirim **langsung** |
| Kirim dari wallet validator | Offer pending kalau tidak di-accept | **Langsung masuk** jika penerima punya preapproval |
| UX web CanQuest | Backend bisa auto-accept (quest/send) | User **tidak perlu** accept tiap kiriman masuk |
| Biaya setup | Gratis (per transfer) | Sekali ~**$1/tahun** (fee preapproval, dibakar) |
| App reward ke provider | Ada di transfer via preapproval | **Provider** (biasanya validator) dapat app reward |

**CanQuest memakai Opsi B untuk penerimaan CC.** Opsi A (offer + accept) tetap dipakai di backend untuk transfer antar user lewat API sampai integrasi Token Standard penuh.

---

## Peran party (Canton)

```
┌──────────────────┐     TransferPreapproval      ┌──────────────────┐
│  Receiver        │ ◄── (receiver = user) ────── │  Provider        │
│  (user CanQuest) │     provider = validator     │  (operator node) │
└────────┬─────────┘                              └────────┬─────────┘
         │                                                  │
         │  CC masuk (direct)                               │ bayar fee renewal
         │  tanpa Accept manual                             │ terima app reward
         ▼                                                  ▼
   Saldo di Splice Wallet                          Featured App markers
```

- **Receiver** = party user (`username::1220...`).
- **Provider** = party operator validator (sama node kamu).
- Masa berlaku preapproval: **90 hari** (validator API), perpanjangan otomatis jika provider = validator.

---

## Alur wajib per user CanQuest

### 1. Buat wallet (sekali)

Di **Wallet** → pilih username → **Create Wallet**.

Backend otomatis:
1. `POST /admin/users` — daftar di Splice + Party ID
2. `POST /wallet/transfer-preapprovals` — buat **TransferPreapproval** (CIP-56)
3. `FeaturedAppActivityMarker` — `wallet_created` (app reward)

**Cek sukses:** Party ID harus `username::1220...`, **bukan** `canquest:user:...`.

### 2. Pastikan preapproval aktif

Di web: banner di halaman Wallet, atau:

```http
GET /api/party/preapproval-status
```

Respons `preapproval.active: true` → siap terima CC langsung (Opsi B).

Kalau `false`:

```http
POST /api/party/ensure-preapproval
```

Atau tombol **Aktifkan preapproval (CIP-56)** di Wallet.

### 3. Kirim CC dari wallet validator (manual)

Di **Splice Wallet UI** (VPS 1, login sebagai `administrator` atau treasury):

1. Paste **Party ID lengkap** user dari tab **Receive** di CanQuest
2. Kirim CC — UI Splice **otomatis pakai preapproval** jika receiver sudah punya
3. **Tidak perlu** Accept di sisi user
4. Refresh saldo di canquest.cc

> Ini alur Opsi B yang benar untuk fund manual dari node validator.

### 4. Reward quest / spin / admin (otomatis)

Backend CanQuest:
- Tetap: `createTransferOffer` + `acceptOfferViaWallet` (reliable lewat API)
- Plus: `FeaturedAppActivityMarker` per aksi (`quest_completed`, `cc_transfer`, dll.)

User **sudah punya preapproval** → tidak mengubah reward flow, tapi **validator → user via UI** jadi direct.

---

## App reward (dApp CanQuest)

Agar node kamu dapat **app reward** dari aktivitas user:

### Env wajib di `apps/api/.env`

```env
# Party operator / app provider (biasanya sama dengan validator admin party)
CANTON_APP_PROVIDER_PARTY_ID=<party_id_validator_operator>

# Ledger + Splice (sudah ada)
CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost
CANTON_SPLICE_SECRET=unsafe
CANTON_SPLICE_AUDIENCE=https://canton.network.global
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global
CANTON_LEDGER_API_USER=ledger-api-user
CANTON_VALIDATOR_PARTY_ID=<party_id_treasury_validator>
```

Cara dapat `CANTON_APP_PROVIDER_PARTY_ID`:

```bash
cd ~/canquest/apps/api && set -a && source .env && set +a
node scripts/get-validator-party-id.cjs
# atau GET /admin/users/administrator → party_id
```

### Aksi yang emit marker (sudah di kode)

| Aksi | `activityType` |
|------|----------------|
| Buat wallet | `wallet_created` |
| Selesaikan task quest | `task_verified` |
| Selesai quest + reward | `quest_completed` |
| Kirim CC antar user | `cc_transfer` |

DevNet: marker bisa no-op kecuali validator terdaftar sebagai **featured app**. MainNet: reward CC nyata ke app provider.

---

## Checklist Opsi B (production)

| # | Item | Status |
|---|------|--------|
| 1 | Tunnel 7575 + 8080 aktif | ⬜ |
| 2 | User wallet `username::1220...` | ⬜ |
| 3 | `preapproval.active === true` | ⬜ |
| 4 | `CANTON_APP_PROVIDER_PARTY_ID` terisi | ⬜ |
| 5 | Kirim test dari validator UI → saldo web naik | ⬜ |
| 6 | Quest reward / send CC di app jalan | ⬜ |
| 7 | PM2 logs: `TransferPreapproval created` / `Offer accepted` | ⬜ |

---

## Troubleshooting Opsi B

| Masalah | Penyebab | Solusi |
|---------|----------|--------|
| Kirim validator, saldo 0 | Preapproval tidak aktif / Party ID salah | `POST ensure-preapproval`, cek Party ID |
| `createTransferPreapproval` gagal | User belum di Splice / saldo user 0 untuk fee | Fund sedikit via offer dulu atau fund dari validator setelah preapproval |
| Preapproval ada tapi UI validator gagal | Bukan CC / network beda | Pastikan DevNet sama |
| App reward tidak muncul | `CANTON_APP_PROVIDER_PARTY_ID` kosong | Isi env + restart PM2 |
| Toggle preapproval di Settings tidak efek | Hanya localStorage lama | Pakai Wallet banner + `ensure-preapproval` |

---

## Riwayat transaksi "CC received" (TRANSFER_IN)

CanQuest menyinkronkan saldo **Splice Wallet** (on-chain) ke database:

- Setiap kenaikan saldo → baris **TRANSFER_IN** (`CC received`)
- Berlaku untuk kiriman dari validator, user CanQuest, atau Party ID luar
- Jalan otomatis tiap **30 detik** + saat buka **Wallet / refresh balance**

Env:

```env
CC_INBOUND_SYNC_ENABLED=true
CC_INBOUND_SYNC_POLL_MS=30000
```

Setelah deploy, user production yang menerima CC akan melihat history di **API/VPS yang sama** (bukan DB lokal).

---

## Roadmap teknis (setelah Opsi B stabil)

1. Integrasi **Token Standard API** untuk direct transfer programmatic (ganti offer+accept di reward).
2. Renewal monitoring preapproval (< 30 hari expiry).
3. MainNet: featured app registration + pisah DB per network.

---

## Ringkasan satu kalimat

**Opsi B = setiap user CanQuest wajib punya TransferPreapproval aktif; kirim dari wallet validator langsung ke Party ID user; CanQuest tetap catat aktivitas untuk app reward lewat FeaturedAppActivityMarker.**
