# CanQuest — Auth Model Decision & Arsitektur Dua Lapis

> **Dokumen ini menjawab pertanyaan:** "Apakah login user = token Canton? Apakah perlu JWT terpisah? Apa bedanya `dapp-admin`, `dapp-reward`, dan token user?"
>
> **Kesimpulan:** CanQuest sekarang adalah **Model B** (backend-as-operator). Tetap di sini. Dokumen ini menjelaskan mengapa, dan apa artinya secara teknis.

---

## 1. Tidak Ada "Dua JWT" — Hanya Satu Auth0, Dua Tujuan

Tidak ada "bearer Canton" yang berbeda dari "JWT luar". Validator dan dApp memakai **OIDC provider yang sama** (di CanQuest: secret HS256 untuk ledger, JWT RS256/HS256 untuk app). Yang membedakan tiap token hanya dua hal:

| Field | Token Ledger (Canton) | Token App (CanQuest) |
|-------|----------------------|---------------------|
| `sub` | user-id ledger (e.g. `ledger-api-user`) | userId PostgreSQL (CUID) |
| `aud` | `https://canton.network.global` | `https://api.canquest.cc` (implisit via `JWT_ACCESS_SECRET`) |
| Dipakai untuk | Submit command ke Ledger API | Autentikasi ke NestJS backend |
| Dibuat oleh | `CantonLedgerService.ledgerToken()` | `AuthService.issueTokens()` |

**Jadi:** token user CanQuest **tidak** dipakai untuk act di ledger, dan token ledger **tidak** dipakai untuk login user. Keduanya hidup di lapisan berbeda.

---

## 2. Dua Model dApp Canton — Posisi CanQuest

### Model A — User adalah Party Sungguhan (Self-Custody)

```
User → Auth0 login → token dengan aud=ledger → submit langsung ke Ledger API
```

- 1 orang = 1 akun = 1 participant user = 1 party
- User memegang & bertindak atas asetnya sendiri di ledger
- Token login user **sekaligus** token ledger (audience ledger)
- Onboarding: `POST /v0/register` (self) atau `POST /v0/admin/users` (admin)
- **Perubahan Daml yang diperlukan:** user harus jadi `signatory` atau `controller`, bukan hanya `observer`

### Model B — Backend sebagai Operator (Custody Terpusat) ← **CanQuest sekarang**

```
User → login ke backend (JWT app) → backend bertindak di ledger via dapp-admin/dapp-reward
```

- User login ke backend dengan token app (audience = backend CanQuest)
- Backend memegang party dan bertindak sebagai operator untuk semua user
- Token user **tidak** dipakai untuk act di ledger
- Daml: `signatory admin`, `observer userAddress` — persis yang ada di `Main.daml` sekarang

---

## 3. Konfirmasi: CanQuest adalah Model B

Bukti dari kode:

```daml
-- packages/daml/daml/Main.daml
template UserAccount
  with
    admin        : Party   -- ← operator/backend
    userAddress  : Party   -- ← user hanya observer
  where
    signatory admin        -- ← HANYA admin yang bisa sign
    observer userAddress   -- ← user hanya bisa lihat

    choice RewardPoints : ContractId UserAccount
      controller admin     -- ← SEMUA choice dikontrol admin
```

```typescript
// apps/api/src/auth/auth.service.ts
private async issueTokens(userId: string, email: string) {
  const accessToken = await this.jwt.signAsync({ sub: userId, email });
  // sub = userId PostgreSQL, bukan ledger user-id
  // audience = JWT_ACCESS_SECRET (app-level, bukan ledger)
}
```

```typescript
// apps/api/src/canton/canton-ledger.service.ts
private ledgerToken(actingUser?: string): string | null {
  const sub = actingUser ?? this.ledgerApiUser; // 'ledger-api-user' dari .env
  return jwt.sign({ sub, aud: this.ledgerAudience }, this.secret, ...);
  // Token ini TERPISAH dari token user — dibuat backend untuk akses ledger
}
```

---

## 4. Apa Itu `dapp-admin` dan `dapp-reward`?

Ini adalah **Splice wallet users** (participant users di ledger), bukan akun Auth0 atau user PostgreSQL.

| Nama | Tipe | Fungsi |
|------|------|--------|
| `ledger-api-user` | Participant user (ledger) | Default user untuk submit command ke Ledger API. Diberi hak `canActAs` semua party yang dialokasikan. |
| `canquest-operator` | Canton Party | DAML signatory — menandatangani semua kontrak (UserAccount, QuestClaim, dll). Diset via `CANTON_OPERATOR_PARTY_ID`. |
| `canquest-fee` | Canton Party | Menerima claim fee dari quest FCFS/raffle. Diset via `CANTON_FEE_RECIPIENT_PARTY_ID`. |
| `canquest-validator-1` | Canton Party (Validator) | Mengirim CC reward ke user. Diset via `CANTON_VALIDATOR_PARTY_ID`. |

**Tidak ada** "dapp-admin" atau "dapp-reward" sebagai entitas terpisah di kode CanQuest sekarang. Yang ada adalah 3 party di atas, semuanya diakses via satu `ledger-api-user`.

---

## 5. Alur Lengkap: Register → Login → Wallet → Quest

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1: Auth App (Web2)                                           │
│                                                                     │
│  POST /api/auth/register                                            │
│    → Buat User di PostgreSQL                                        │
│    → Kirim OTP email (Resend)                                       │
│    → Return: { userId }                                             │
│                                                                     │
│  POST /api/auth/verify-otp                                          │
│    → Verifikasi OTP                                                 │
│    → Return: { accessToken, refreshToken }                          │
│      accessToken = JWT { sub: userId, email }                       │
│      aud = JWT_ACCESS_SECRET (implisit, bukan Canton)               │
│                                                                     │
│  POST /api/auth/login                                               │
│    → Verifikasi password                                            │
│    → Return: { accessToken, refreshToken }                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ accessToken dipakai untuk semua request
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2: Wallet Canton (Core Infrastructure)                       │
│                                                                     │
│  POST /api/party/username  (Bearer: accessToken)                    │
│    → Backend call: SpliceValidatorService.createWalletUser(name)    │
│      POST /api/validator/v0/admin/users { name }                    │
│      Token: adminToken() = JWT { sub: 'ledger-api-user',            │
│                                  aud: CANTON_SPLICE_AUDIENCE }      │
│    → Simpan cantonPartyId di PostgreSQL                             │
│    → Return: { cantonPartyId, username }                            │
│                                                                     │
│  GET /api/party/balance  (Bearer: accessToken)                      │
│    → Backend call: SpliceValidatorService.getUserBalance(username)  │
│      Token: adminToken() — bukan token user                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ cantonPartyId tersimpan di DB
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 3: Quest & Reward (App + DAML)                               │
│                                                                     │
│  POST /api/quests/:id/submit  (Bearer: accessToken)                 │
│    → Verifikasi task (Twitter, quiz, dll)                           │
│    → Simpan QuestSubmission di PostgreSQL                           │
│    → Jika QUEST_LEDGER_ENABLED=true:                                │
│        QuestLedgerService.recordQuestClaim(...)                     │
│        Token: ledgerToken('ledger-api-user')                        │
│        actAs: [CANTON_OPERATOR_PARTY_ID]                            │
│        → Create QuestClaim contract on-chain                        │
│    → Jika ada CC reward:                                            │
│        SpliceValidatorService.createTransferOffer(userPartyId, cc)  │
│        Token: adminToken() — bukan token user                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. `.env` VPS 1 — Bukan Login User

Item di `.env` VPS 1 adalah **infrastruktur node**, bukan mekanisme login user dApp:

```env
# Ini adalah konfigurasi BACKEND untuk akses ke Canton participant
# Bukan token untuk user dApp

CANTON_SPLICE_SECRET=unsafe          # ← Shared secret untuk sign JWT ledger
CANTON_LEDGER_API_USER=ledger-api-user  # ← Participant user yang submit command
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global  # ← Audience token ledger

CANTON_VALIDATOR_PARTY_ID=canquest-validator-1::1220...  # ← Party kirim CC
CANTON_OPERATOR_PARTY_ID=canquest-operator::1220...      # ← Party sign DAML
CANTON_FEE_RECIPIENT_PARTY_ID=canquest-fee::1220...      # ← Party terima fee
```

**Tidak ada** token dari `.env` ini yang dikirim ke user atau dipakai untuk register/login user.

---

## 7. Keputusan: Tetap Model B

### Mengapa tetap Model B sekarang?

1. **Daml sudah live di mainnet** — semua template pakai `signatory admin`, `controller admin`. Migrasi ke Model A butuh rewrite Daml + redeploy DAR.

2. **Lebih sederhana untuk quest platform** — user tidak perlu memahami Canton party, signing key, atau ledger. Backend yang mengurus semua itu.

3. **Tidak ada self-custody yang diperlukan** — CC reward dikirim ke wallet user (party mereka), tapi user tidak perlu sign transaksi sendiri.

4. **Konsisten dengan arsitektur sekarang** — `party.controller.ts` sudah mengelola wallet creation, transfer, balance — semua via backend.

### Kapan pertimbangkan Model A?

Hanya jika:
- User perlu **sign transaksi sendiri** (true self-custody)
- User perlu **memegang private key** mereka sendiri
- Daml diubah sehingga user jadi `signatory` atau `controller`

Ini adalah migrasi besar yang direncanakan terpisah, bukan sekarang.

---

## 8. Ringkasan Token yang Ada di Sistem

| Token | Dibuat oleh | `sub` | `aud` | Dipakai untuk |
|-------|------------|-------|-------|---------------|
| **App JWT** (accessToken) | `AuthService.issueTokens()` | userId PostgreSQL | (via JWT_ACCESS_SECRET) | Autentikasi ke NestJS API |
| **Refresh Token** | `AuthService.issueTokens()` | — | — | Perbarui accessToken |
| **Ledger JWT** | `CantonLedgerService.ledgerToken()` | `ledger-api-user` | `https://canton.network.global` | Submit command ke Ledger API |
| **Admin JWT** | `SpliceValidatorService.adminToken()` | `ledger-api-user` | `CANTON_SPLICE_AUDIENCE` | Panggil Splice Validator API |
| **Wallet JWT** | `SpliceValidatorService.signToken(username, aud)` | username Splice | `CANTON_SPLICE_WALLET_AUDIENCE` | Panggil wallet endpoint per-user |

**User hanya memegang App JWT.** Semua token lain dibuat dan dikelola oleh backend.

---

## 9. Checklist Implementasi (Model B — Status Sekarang)

- [x] Register/login user via email + OTP → App JWT
- [x] Wallet creation via `POST /api/party/username` → Splice `createWalletUser`
- [x] CC balance via `GET /api/party/balance` → Splice `getUserBalance`
- [x] CC reward via `POST /api/party/claim-reward` → CIP-0056 TransferFactory
- [x] CC transfer via `POST /api/party/send-cc` → Splice preapproval / offer
- [x] Quest submit via `POST /api/quests/:id/submit` → PostgreSQL + optional DAML
- [x] DAML audit trail via `QuestLedgerService` → `ledger-api-user` actAs operator
- [x] 3 party terpisah: validator, operator, fee
- [ ] `QUEST_LEDGER_ENABLED=true` di mainnet (opsional, aktifkan setelah stable)
- [ ] `CLAIM_SESSION_LEDGER_ENABLED=true` di mainnet (opsional)

---

## 10. Referensi

- [Canton Ledger API — User Management](https://docs.canton.network/reference/json-api-reference/post-v2users:user-idrights)
- [Splice Validator API — Admin Users](https://docs.canton.network/appdev/modules/m4-canton-coin)
- [CIP-0056 Token Standard Transfer](https://github.com/global-synchronizer-foundation/cips/blob/main/cip-0056/cip-0056.md)
- [Canton M3 — Authorization Pattern](https://docs.canton.network/appdev/modules/m3-dev-environment)
- [CanQuest Architecture Layers](./ARCHITECTURE_LAYERS.md)
- [CanQuest Mainnet Deploy Guide](./MAINNET_DEPLOY_CANQUEST_v10.md)
