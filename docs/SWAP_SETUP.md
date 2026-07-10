# Swap Feature — CanQuest × Cantex DEX

Fitur swap CC ↔ semua token Cantex DEX (model custodial Wintip-style).

## Status

- **Phase 1 (DONE)**: Schema + Cantex client read-only + UI dengan live quote preview.
  Swap execution (POST `/party/swap`) masih return **503** — aman, tidak ada risiko dana.
- **Phase 2 (TODO)**: Live swap execution (transfer CC + Cantex intent swap + WS confirm).
  Butuh 2 private key Cantex verified against mainnet dulu.

## Arsitektur Custody (Wintip-style)

```
USER PARTY (per-user)          CANTEX TRADING ACCOUNT (shared)
User.cantonPartyId              cantex::1220c6c1c6221fac...
┌──────────────┐               ┌──────────────────────────────┐
│ CC (Amulet)  │◄──── CC ─────►│ CC pool + semua token Cantex │
│ on-chain     │   Canton xfer │ TokenX, TokenY, ...          │
└──────────────┘               │ (2 key: operator + trading)  │
                               └──────────────────────────────┘
                                          │ off-chain ledger
                                          ▼
                               CantexTokenBalance table
                               (userId, instrument, saldo)
```

- **CC**: tetap on-chain per user party. CanQuest operator punya actAs.
- **Token non-CC**: off-chain `CantexTokenBalance`. Token asli di trading account shared.

## File yang dibuat/diubah (Phase 1)

### Backend (apps/api)
- `prisma/schema.prisma` — enum `SWAP_OUT`/`SWAP_IN` + model `CantexTokenBalance` + `SwapTransaction`.
- `src/common/prisma-types.ts` — type mirror: tambah `SWAP_OUT`/`SWAP_IN`.
- `src/users/users.service.ts` — `isDebit` (line ~362) + `FEED_TX_TYPES` + `BADGE_UNREAD_TX_TYPES`.
- `src/cantex/cantex.types.ts` — type definitions (InstrumentId, Pool, SwapQuote, errors).
- `src/cantex/cantex-signers.ts` — Ed25519 (OperatorKeySigner) + secp256k1 DER (IntentTradingKeySigner).
- `src/cantex/cantex-client.ts` — REST client: auth challenge-response + retry + read methods.
- `src/cantex/cantex.config.ts` — env reader.
- `src/cantex/cantex.module.ts` — @Global module.
- `src/app.module.ts` — wire CantexModule.
- `src/party/dto/swap-quote.dto.ts` — DTO quote.
- `src/party/dto/swap.dto.ts` — DTO execute.
- `src/party/party.controller.ts` — endpoint: GET swap/status, GET swap/pools, POST swap/quote, POST swap (503 stub).

### Frontend (apps/web)
- `components/app/wallet/wallet-actions.tsx` — tombol Swap (grid 4-col).
- `components/app/wallet/swap-modal.tsx` — modal: token picker + direction toggle + live quote.
- `components/app/wallet/transactions-view.tsx` — type SWAP_OUT/SWAP_IN + icon.
- `lib/i18n/types.ts` + `messages/en.ts` + `messages/tr.ts` — label swap.

## Setup Env (apps/api/.env)

```env
# ── Cantex DEX (Phase 1: opsional; Phase 2: wajib) ──
CANTEX_ENABLED=false              # true = quote live; false = endpoint 503
CANTEX_API_BASE_URL=https://api.cantex.io
CANTEX_OPERATOR_KEY=              # 64-hex Ed25519 private key (Phase 2)
CANTEX_TRADING_KEY=               # 64-hex secp256k1 private key (Phase 2)
CANTEX_API_KEY_PATH=              # path cache api_key Cantex (optional)
CANTEX_TRADING_ACCOUNT_PARTY=cantex::1220c6c1c6221fac767f94d553f99b7ff1b36c928971168e1b2a0477469c7b07264b
CANTEX_CC_INSTRUMENT_ID=Amulet
CANTEX_CC_INSTRUMENT_ADMIN=       # admin party CC/Amulet (didapat dari getPools())
```

## Deployment Steps

### 1. Migrasi database
```bash
cd apps/api
npx prisma migrate dev --name add_swap_feature
```
Ini buat tabel `CantexTokenBalance` + `SwapTransaction` + tambah enum values.

### 2. Set env (Phase 1 — minimal, quote-only)
```env
CANTEX_ENABLED=true
CANTEX_API_BASE_URL=https://api.cantex.io
CANTEX_CC_INSTRUMENT_ID=Amulet
# CANTEX_CC_INSTRUMENT_ADMIN: ambil dari response GET /party/swap/pools pertama kali.
# Operator/trading key belum wajib di Phase 1 (read-only pakai anon? perlu verify).
```

### 3. Deploy
API + Web rebuild. Endpoint swap muncul, modal Swap tampil di wallet.

## Phase 2 Prerequisites (sebelum live execution)

1. **Verify 2 key Cantex**:
   - Operator key (Ed25519, 64 hex) — untuk auth + ledger transfer signing.
   - Trading key (secp256k1, 64 hex) — untuk intent swap signing.
   - Test: `cantexClient.authenticate()` → `getAccountInfo()` vs mainnet.

2. **Provisioning trading account**:
   - Trading account (`create_trading_account()`) sudah ada di party cantex::1220c6...
   - Intent trading account terdaftar (`create_intent_trading_account()` — register secp256k1 pubkey).
   - Preapproval CC aktif (supaya CC transfer user→trading = direct, bukan offer).

3. **Liquidity**: trading account harus punya CC balance cukup untuk serve TokenX→CC swaps.

## Endpoint Reference

| Method | Path | Auth | Status | Deskripsi |
|--------|------|------|--------|-----------|
| GET | `/party/swap/status` | JWT | Live | Cek swap enabled + phase |
| GET | `/party/swap/pools` | JWT | Live (bila CANTEX_ENABLED) | Daftar token swap-able |
| POST | `/party/swap/quote` | JWT | Live (bila CANTEX_ENABLED) | Live quote preview |
| POST | `/party/swap` | JWT | **503** (Phase 2) | Execute swap |

## Signing Reference (penting untuk Phase 2)

Dua skema signature (port dari Python SDK `_sdk.py`):

| Operasi | Signer | Sign | Encoding | Wire field |
|---------|--------|------|----------|------------|
| Auth | Ed25519 | UTF-8 bytes server message | base64url no-pad | `signature` |
| Ledger tx | Ed25519 | decoded transaction_hash (base64) | base64url no-pad | `operatorKeySignedTransactionHash` |
| Intent swap | secp256k1 | 32-byte digest (no re-hash) | DER hex | `intentTradingKeySignature` |

**Aturan base64 kritikal**:
- **Outbound** (semua signature): `base64url` (no padding) — `Buffer.from(x).toString('base64url')`.
- **Inbound** `transaction_hash` dari server: **standard** base64 — `Buffer.from(hash, 'base64')`.
