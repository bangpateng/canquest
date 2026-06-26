# Migrasi: Keycloak + API Canton Publik (Bebas SSH Tunnel & Kode Legacy)

> **Status**: SELESAI (Fase 1). Fase 2 (bersihkan DB placeholder) siap dijalankan.
>
> **Tanggal**: 2026-06-27
>
> Dokumen ini adalah sumber kebenaran terkini untuk koneksi on-chain CanQuest.
> Beberapa dokumen lama di `docs/` (mis. `AUTH_MODEL_DECISION.md`,
> `VPS2_DEPLOY.md`) masih menyebut SSH tunnel / HS256 sebagai setup utama —
> itu adalah **konteks historis/dev**. Setup **PRODUKSI** ada di sini.

---

## TL;DR — Apa yang berubah

| Sebelum (legacy) | Sesudah (sekarang) |
|---|---|
| Validator via SSH tunnel `http://127.0.0.1:8080` (Host: wallet.localhost) | Gateway publik `https://api-canquest.nodelab.my.id` (TLS, Cloudflare) |
| Ledger via tunnel `http://127.0.0.1:7575` / `CANTON_JSON_API_URL` | Gateway publik `https://api-ledger-canquest.nodelab.my.id` (`LEDGER_API_URL`) |
| HS256 shared secret (`CANTON_SPLICE_SECRET`) | Keycloak `client_credentials` (`LEDGER_AUTH_MODE=keycloak`) — satu-satunya mode |
| Secret `LEDGER_CLIENT_SECRET` kedaluwarsa | Secret valid `e2qjUrUT...` (dipakai di `.env`) |

Semua transaksi on-chain & tampilan data on-chain sekarang via **API publik + Keycloak**.
Login web tetap email+password lokal (sudah solid: bcrypt, OTP, Turnstile, throttler).

---

## 1. Arsitektur koneksi (PRODUKSI)

```
Browser ──(cookie cq_access JWT)──▶ apps/web (Next.js, /api/party/*)
                                         │ (proxy + Bearer)
                                         ▼
                                    apps/api (NestJS)
                                         │
              ┌──────────────────────────┼───────────────────────┐
              ▼                          ▼                       ▼
   Keycloak (auth)            Ledger API (on-chain)    Validator API (wallet)
   oauth-canquest.nodelab     api-ledger-canquest      api-canquest
   client_credentials         /v2/commands, /v2/state  /api/validator/v0/*
   → bearer token ledger      ACS query, submit        balance, admin/users,
                                                     scan-proxy (CIP-0056)
```

- **Keycloak** (`oauth-canquest.nodelab.my.id`, realm `canton`):
  - `validator-app-backend` (confidential, service account) → token untuk operasi ledger/validator sebagai operator.
  - `admin-cli` (master realm, password grant) → manage user identity saat onboarding wallet (`KEYCLOAK_ADMIN_USER/PASSWORD`).
- **Ledger API** (`api-ledger-canquest.nodelab.my.id`): Canton JSON Ledger API v2 — submit command, ACS query, grant rights. Base URL = `LEDGER_API_URL`.
- **Validator API** (`api-canquest.nodelab.my.id`): Splice wallet REST — `/api/validator/v0/wallet/balance`, `/admin/users`, `/scan-proxy/*`.

---

## 2. Variabel `.env` PRODUKSI (bagian Canton)

```env
# Validator + Scan — gateway publik (BUKAN localhost)
CANTON_VALIDATOR_URL=https://api-canquest.nodelab.my.id
CANTON_VALIDATOR_HOST_HEADER=                          # KOSONG (route via SNI, bukan wallet.localhost)
CANTON_SCAN_URL=https://api-canquest.nodelab.my.id/api/validator/v0/scan-proxy

# Ledger API — gateway publik
LEDGER_API_URL=https://api-ledger-canquest.nodelab.my.id

# Auth: Keycloak SAJA (hs256 dihapus dari kode — throw jika bukan keycloak)
LEDGER_AUTH_MODE=keycloak
KEYCLOAK_URL=https://oauth-canquest.nodelab.my.id
KEYCLOAK_REALM=canton
LEDGER_API_AUTH_SCOPE=daml_ledger_api
LEDGER_CLIENT_ID=validator-app-backend
LEDGER_CLIENT_SECRET=<secret valid dari Keycloak admin>     # JANGAN pakai secret lama
LEDGER_API_ADMIN_USER=<UUID admin Keycloak>                 # userId untuk submit / grant rights
KEYCLOAK_ADMIN_USER=<admin-cli user>
KEYCLOAK_ADMIN_PASSWORD=<admin-cli password>

# Party IDs — dari validator real (bukan placeholder)
CANTON_VALIDATOR_PARTY_ID=canquest-validator-1::1220...
CANTON_OPERATOR_PARTY_ID=canquest-operator::1220...
CANTON_FEE_RECIPIENT_PARTY_ID=canquest-fee::1220...
```

### Yang DIHAPUS / TIDAK dipakai lagi
- `CANTON_SPLICE_SECRET` — hs256 legacy, dihapus (ganti secret juga direkomendasikan untuk keamanan).
- `SPLICE_VALIDATOR_URL`, `SPLICE_VALIDATOR_HOST_HEADER`, `SPLICE_BOT_*` — tidak dipakai kode.
- SSH tunnel `ssh -N -L 7575/8080 ...` — tidak diperlukan lagi di produksi.

---

## 3. Verifikasi endpoint (smoke test hasil)

Semua endpoint berikut **terverifikasi reachable + auth OK** via gateway publik (2026-06-27):

| Endpoint | Status | Dipakai oleh |
|---|---|---|
| `GET /api/validator/v0/wallet/balance` | 200 (round=101968) | `getCurrentRound` |
| `POST /api/validator/v0/admin/users` | 201 | `createWalletUser` |
| `GET /api/validator/v0/scan-proxy/amulet-rules` | 200 | `createTransferPreapproval` |
| `GET /api/validator/v0/scan-proxy/open-and-issuing-mining-rounds` | 200 | `createTransferPreapproval` |
| `GET https://api-ledger.../livez` | 200 | health |
| `GET https://api-ledger.../v2/state/ledger-end` | 200 | `queryAmuletHoldings` |
| `GET https://api-ledger.../v2/parties` | 200 | `listParties` |

> Catatan: `GET /api/validator/v0/readyz` mengembalikan 404 di gateway publik.
> `SpliceValidatorService.isReachable()` punya fallback ke `/admin/users` (auth) — aman.

---

## 4. Apa yang TIDAK berubah (sudah benar)

- **Login/register web** tetap email+password lokal (bcrypt 12, OTP email, Cloudflare Turnstile,
  anti-enumeration, refresh-token rotation). Bukan vektor serangan lemah.
- **Leaderboard / points** dari PostgreSQL aplikasi (bukan on-chain) — memang seharusnya begitu,
  points = skor quest, bukan token.
- Semua proxy web `/api/party/*` → backend Nest via cookie JWT.
- Guard `startsWith('canquest:')` dipertahankan sebagai safety net (murah, anti party invalid).

---

## 5. Fase 2 — Bersihkan DB placeholder (belum dijalankan)

Pola `canquest:` di `User.cantonPartyId` = party lokal/stub lama. Script disediakan:

```bash
cd apps/api

# 1. AUDIT (baca-saja) — lihat berapa user placeholder
npx ts-node prisma/scripts/audit-placeholder-parties.ts

# 2. DRY-RUN re-onboard (cetak rencana)
npx ts-node prisma/scripts/re-onboard-placeholder-parties.ts

# 3. EKSEKUSI re-onboard ke Keycloak + party real
npx ts-node prisma/scripts/re-onboard-placeholder-parties.ts --confirm
```

Script re-onboard menjalankan per user: buat Keycloak identity → allocate party real via
validator → bridge UUID↔party di ledger + grant rights → update `User.cantonPartyId` & `keycloakId`.
Idempoten, dry-run default, satu-user-per-langkah.

---

## 6. Opsi masa depan — Migrasi auth ke Keycloak OIDC (TERPISAH)

Kerjakan **terpisah** hanya kalau butuh MFA / SSO multi-app / hapus password dari DB app.
Scope: NextAuth/Auth.js provider Keycloak di `apps/web`, migrasi user existing,
verifikasi token Keycloak di `AuthGuard('jwt')`. Risiko besar → fase terpisah.
Login lokal saat ini sudah cukup aman.
