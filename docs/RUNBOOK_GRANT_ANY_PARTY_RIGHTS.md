# Runbook — Grant CanActAsAnyParty ke Service-Account

> **Tujuan:** Fix `DAML_AUTHORIZATION_ERROR` saat Settle choice (atomic fee+reward).
> Backend butuh actAs `[operator, user, rewardSender]` tapi service-account hanya punya
> `CanActAs app-canquest` (party provider), bukan user party.
>
> **Tanggal:** 2026-08-06
> **Root cause:** Service-account (`fc334391-...`) rights belum cover user parties.
> **Fix:** Grant `CanActAsAnyParty` (1x, permanent, cover semua user).
> **Trade-off:** ⚠️ Token security jadi single point of failure. Lihat §4.

---

## TL;DR

```bash
# Di VPS 1 (participant node), jalankan 1x:
PARTICIPANT="http://172.18.0.6:7575"
REAL_USER="fc334391-0f6a-456f-bb95-098b269e62b6"
TOKEN=$(curl -s ... keycloak token...)

curl -X POST "$PARTICIPANT/v2/users/$REAL_USER/rights" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"identityProviderId":"","userId":"'"$REAL_USER"'","rights":[{"kind":"CanActAsAnyParty"}]}'
```

Lalu test claim → cari `Settle OK`.

---

## §1. Konteks — Kenapa Ini Diperlukan

### Error yang muncul
```
DAML_AUTHORIZATION_ERROR: node ExternalPartyAmuletRules requires authorizers: karel
but only given: canquest-operator
```

### Kenapa
Settle choice (DAML v23) butuh authorization dari **3 party** dalam 1 transaction tree:
1. `canquest-operator` — signatory DAML (leg fee controller via actAs)
2. `karel` (user) — **leg fee: TransferFactory_Transfer controller = user (sender fee)**
3. `canquest-reward-user` — leg reward: controller = rewardParty (sender reward)

Backend submit `actAs: [operator, user, rewardSender]`. Canton cek: apakah service-account
token **authorized actAs** ketiganya?

- `CanActAs app-canquest` → cover operator ✅
- User party (karel) → **tidak ada CanActAs** ❌
- Reward party → mungkin ada (test nanti)

### Bukti dari docs sendiri (`WALLET_USER_PROXY_SETUP.md:118`)
```
rights: ParticipantAdmin, CanReadAsAnyParty, CanActAs app-canquest (+ user parties)
                                                              ^^^^^^^^^^^^^^^^
                                                              HANYA app-canquest
                                                              (+ user parties yg blm di-grant)
```

---

## §2. Cara Cek Rights Sekarang (diagnostik)

SSH ke **VPS 1** (participant node, `162.250.191.195`), lalu:

```bash
# Akses participant langsung (bypass nginx gateway)
PARTICIPANT="http://172.18.0.6:7575"
REAL_USER="fc334391-0f6a-456f-bb95-098b269e62b6"

# Ambil token admin (Keycloak client_credentials)
# Sesuaikan dengan setup Keycloak Anda:
TOKEN=$(curl -s -X POST "http://localhost:8084/realms/splice-validator/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=validator-app-backend" \
  -d "client_secret=$CLIENT_SECRET" \
  | jq -r '.access_token')

# Cek rights sekarang
curl -s "$PARTICIPANT/v2/users/$REAL_USER/rights" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Seharusnya muncul:** `ParticipantAdmin`, `CanReadAsAnyParty`, `CanActAs app-canquest`.
**Yang kurang:** `CanActAsAnyParty`.

---

## §3. Grant CanActAsAnyParty (fix utama)

### ⚠️ PENTING: Tiru format dari rights yang SUDAH ADA

Format `CanActAsAnyParty` di Canton v2 REST API bisa salah satu dari beberapa bentuk.
**Cara paling reliable: ambil format dari `CanReadAsAnyParty` yang sudah ada di response
§2, lalu ganti namanya jadi `CanActAsAnyParty`.** Format yang sudah diterima participant
Anda = format yang benar.

### Langkah 3a — Lihat format CanReadAsAnyParty di response §2

Dari output §2 (`GET .../rights`), cari entry `CanReadAsAnyParty`. Catat format-nya:
```json
// Contoh kemungkinan format (PILIH SESUAI output Anda):
{ "kind": "CanReadAsAnyParty" }                          // ← format A: PascalCase flat
{ "kind": { "CanReadAsAnyParty": {} } }                  // ← format B: PascalCase nested
{ "canReadAsAnyParty": {} }                              // ← format C: camelCase flat
```

### Langkah 3b — Tiru format itu, ganti jadi Act

Ganti `Read` → `Act` di format yang Anda temukan di 3a. Contoh:
- Format A → `{ "kind": "CanActAsAnyParty" }`
- Format B → `{ "kind": { "CanActAsAnyParty": {} } }`
- Format C → `{ "canActAsAnyParty": {} }`

### Langkah 3c — Grant pakai format yang sudah dipastikan

```bash
PARTICIPANT="http://172.18.0.6:7575"
REAL_USER="fc334391-0f6a-456f-bb95-098b269e62b6"
# TOKEN dari §2
# Ganti FORMAT_ACT di bawah dgn format dari langkah 3b:

curl -X POST "$PARTICIPANT/v2/users/$REAL_USER/rights"   -H "Authorization: Bearer $TOKEN"   -H "Content-Type: application/json"   -d '{
    "identityProviderId": "",
    "userId": "'"$REAL_USER"'",
    "rights": [
      FORMAT_ACT_DARI_LANGKAH_3B
    ]
  }'

# Contoh kalau format A:
# curl -X POST "$PARTICIPANT/v2/users/$REAL_USER/rights" #   -H "Authorization: Bearer $TOKEN" #   -H "Content-Type: application/json" #   -d '{"identityProviderId":"","userId":"'"$REAL_USER"'","rights":[{"kind":"CanActAsAnyParty"}]}'

# Verifikasi grant berhasil
curl -s "$PARTICIPANT/v2/users/$REAL_USER/rights"   -H "Authorization: Bearer $TOKEN" | jq .
```

**Verifikasi:** response `rights` sekarang harus ada entry `CanActAsAnyParty`
(dengan format yang sama seperti `CanReadAsAnyParty`).

---

## §4. ⚠️ SECURITY HARDENING (WAJIB baca)

`CanActAsAnyParty` = service-account bisa **actAs party manapun di participant**.
Kalau token bocor, attacker bisa submit transfer dari wallet user manapun.

### Checklist hardening (LAKUKAN setelah grant):

- [ ] **Keycloak client_secret AMAN** — rotate secara berkala, simpan di secret manager
      (bukan .env plain text, apalagi tidak commit ke git)
- [ ] **Network restriction** — participant JSON API (`172.18.0.6:7575`) HANYA accessible
      dari VPS 2 (dapp backend), tidak expose ke internet publik
- [ ] **Audit log Keycloak** — monitor token usage anomali (volume besar, party unusual)
- [ ] **Rate limit backend** — limit submit command per user per menit (anti spam)
- [ ] **Wallet withdrawal limit** — app-level cap harian per user (defense in depth)
- [ ] **Backup plan** — kalau token compromise, rotate client_secret ASAP (semua token lama invalid)

### Alternatif yang lebih aman (kalau mau hardening lebih ketat)
`CanActAs(party)` per-user (limit blast radius). Tapi butuh:
- Fix `allocateParty` jadi fail-fast (throw kalau grant gagal)
- Admin endpoint `grant-rights?user=@karel` untuk re-grant on-demand
- Bulk endpoint untuk fix user lama

**Untuk sekarang: AnyParty lebih cepat & sesuai rekomendasi Canton docs.** Hardening di atas
wajib dijalankan.

---

## §5. Test Settle Setelah Grant

1. **Jangan rebuild API** — ini bukan code change, hanya participant rights.
2. Buat **quest BARU** (CC FCFS, reward > 0, fee > 0).
3. Claim sebagai user (karel atau user lain).
4. Cek log:
```bash
# Di VPS 2:
pm2 logs canquest-api --lines 100 --nostream | grep -iE "DAML_SETTLE_FAIL|Settle OK|Atomic Settle"
```

**🎯 Target:**
```
Settle OK: settled=... updateId=... reward=true
```

**Verifikasi atomicity:**
- ❌ Tidak ada `DAML_AUTHORIZATION_ERROR`
- ❌ Tidak ada `DAML_SETTLE_FAIL`
- ❌ Tidak ada `collectClaimFee` (path fallback)
- ✅ Fee + reward = 1 updateId (cek DB: `claimFeeLedgerTxId` == `ledgerTxId`)

---

## §6. Kalau Masih Error

### Error: `CanActAsAnyParty` tidak dikenal (format right beda)
Beberapa versi Canton pakai terminologi berbeda. Coba format alternatif:
```json
{ "kind": "CanParticipantAdmin" }
{ "kind": { "CanActAsAnyParty": {} } }
```
Atau cek rights user admin lain yang sudah punya right serupa:
```bash
curl -s "$PARTICIPANT/v2/users/" -H "Authorization: Bearer $TOKEN" | jq .
```

### Error: `USER_NOT_FOUND`
Pakai UUID asli (`fc334391-0f6a-456f-bb95-098b269e62b6`), bukan `validator-app-backend@clients`.
Canton resolve token via UUID `sub`, bukan `@clients` (lihat WALLET_USER_PROXY_SETUP.md:466).

### Error: `401 Unauthorized` / token invalid
- Cek `client_secret` Keycloak
- Cek `LEDGER_AUTH_MODE=keycloak` di .env backend
- Cek token expiry (Keycloak token default 300s)

---

## §7. Setelah Settle OK — Update Docs

Update `docs/WALLET_USER_PROXY_SETUP.md` line 118:
```
# SEBELUM
rights: ParticipantAdmin, CanReadAsAnyParty, CanActAs app-canquest (+ user parties)

# SESUDAH
rights: ParticipantAdmin, CanReadAsAnyParty, CanActAsAnyParty
```

---

## Checklist Eksekusi

- [ ] SSH VPS 1, jalankan §2 (cek rights sekarang) — konfirmasi `CanActAsAnyParty` belum ada
- [ ] Jalankan §3 (grant CanActAsAnyParty)
- [ ] Verifikasi grant via §2 lagi — `CanActAsAnyParty` muncul
- [ ] §5 Test claim real — cari `Settle OK`
- [ ] §4 Security hardening checklist (WAJIB)
- [ ] §7 Update docs WALLET_USER_PROXY_SETUP.md
