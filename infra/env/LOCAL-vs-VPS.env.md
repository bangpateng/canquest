# Local `.env` vs VPS `.env` — Cheat sheet

## Local (`apps/api/.env` — laptop)

```env
NODE_ENV=development
DATABASE_URL=postgresql://canquest:canquest_dev@localhost:5432/canquest_dev
AUTH_REGISTER_SKIP_OTP=true
TRANSACTION_FEE_CC=2

CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost
CANTON_SPLICE_SECRET=unsafe
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global
CANTON_SPLICE_AUDIENCE=https://validator.example.com
CANTON_VALIDATOR_ADMIN_USER=administrator
CANTON_LEDGER_API_USER=ledger-api-user

CC_INBOUND_SYNC_ENABLED=true
CC_INBOUND_SYNC_POLL_MS=30000
LEDGER_INDEXER_ENABLED=true
```

+ JWT / admin → nilai **lokal** (beda VPS).

---

## VPS (`~/canquest/apps/api/.env`)

```env
NODE_ENV=production
DATABASE_URL=postgresql://canquest:<PASSWORD_VPS>@localhost:5432/canquest_app
AUTH_REGISTER_SKIP_OTP=true
TRANSACTION_FEE_CC=3

# Canton — SAMA dengan local (DevNet)
CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost
CANTON_SPLICE_SECRET=unsafe
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global
CANTON_SPLICE_AUDIENCE=https://validator.example.com
CANTON_VALIDATOR_ADMIN_USER=administrator
CANTON_LEDGER_API_USER=ledger-api-user

CC_INBOUND_SYNC_ENABLED=true
CC_INBOUND_SYNC_POLL_MS=30000
LEDGER_INDEXER_ENABLED=true
REDIS_URL=redis://localhost:6379
```

+ JWT → **sama dengan Vercel** (bukan JWT local).

---

## Yang TIDAK ikut `git push`

- `apps/api/.env`
- Password / JWT asli di VPS

Template aman di repo: `infra/env/api.env.vps-production.reference`
