# Diagnosa API lambat (CanQuest)

> Ringkasan: **landing** di Vercel biasanya cepat; **app setelah login** memanggil `api.canquest.cc` → kadang **Splice/Canton** lewat WireGuard. Itu sumber lag paling umum.

## 1. Cek dari browser (paling akurat)

1. Login di https://www.canquest.cc  
2. **F12 → Network** → filter: `api.canquest.cc`  
3. Buka **Wallet** atau **Overview**  
4. Lihat request yang **Time** > 1 detik (merah / pending lama)

| Request | Arti |
|---------|------|
| `GET /api/party/balance` | Balance — harus cepat jika `BALANCE_READ_FROM_DB=true` |
| `GET /api/party/transactions` | Riwayat — biasanya DB saja |
| `POST /api/party/send-cc` | Transfer — normal 3–15+ detik (Canton) |
| `GET /api/party/transactions/:id` | Detail — bisa lambat jika fetch ledger |

## 2. Cek di VPS (API + Canton)

```bash
cd /var/www/canquest

# API hidup?
curl -s http://127.0.0.1:3001/api/health

# Canton + Splice + setting balance (baru)
curl -s http://127.0.0.1:3001/api/health/canton
```

**Interpretasi `health/canton`:**

| Field | OK | Masalah |
|-------|-----|---------|
| `ok: true` | Splice + Ledger terjangkau | — |
| `splice.reachable: false` | WireGuard / `CANTON_VALIDATOR_URL` / validator mati |
| `ledger.reachable: false` | `CANTON_JSON_API_URL` salah atau participant down |
| `checkMs` > 3000 | Tunnel lambat — ini penyebab UI berat |
| `balance.readFromDb: false` | Set di `apps/api/.env` → `BALANCE_READ_FROM_DB=true` |

Setelah ubah `.env`:

```bash
npm run build:api
pm2 delete canquest-api
pm2 start infra/pm2.ecosystem.config.js --only canquest-api --env production
pm2 save
```

## 3. Env disarankan (`apps/api/.env`)

```env
BALANCE_READ_FROM_DB=true
BALANCE_DB_MAX_AGE_MS=60000
BALANCE_BACKGROUND_DEBOUNCE_MS=15000
CC_INBOUND_SYNC_ENABLED=true
CC_INBOUND_SYNC_POLL_MS=30000
```

Lihat juga `apps/api/env.example.txt`.

## 4. WireGuard

Pastikan VPS 2 ↔ VPS 1 WireGuard **active** dan URL di `.env` memakai **IP Docker VPS 1**, bukan `127.0.0.1` (kecuali masih pakai SSH tunnel).

Detail: [NETWORK_TOPOLOGY.md](./NETWORK_TOPOLOGY.md)

## 5. Bukan penyebab (sudah dicek)

- **CleanTalk / New Relic** — tidak ada di HTML live `www.canquest.cc`
- **Landing PageSpeed** — terpisah dari beban API setelah login
