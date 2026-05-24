# On-chain transaction explorer (CanQuest)

Sesuai arsitektur Canton [Choose Your Path](https://docs.canton.network/appdev/get-started/choose-your-path) / [Module 4](https://docs.canton.network/appdev/modules/m4-building-apps-intro): **browser → backend VPS 2 → JSON Ledger API VPS 1**.

## Dua jalur (digabung di CanQuest)

| Jalur | Fungsi | Implementasi |
|-------|--------|----------------|
| **1 — CantonScan** | Bukti transaksi di jaringan global (metadata / hash) | Tombol **View on CantonScan** jika `cantonUpdateId` ada |
| **2 — Internal explorer** | Detail bisnis (amount, deskripsi, counterparty) + event kontrak untuk party user | `/transactions/[id]` + `GET /api/party/transactions/:id` |

## Alur data

1. **Submit transfer** → Splice / Ledger API → simpan `ledgerTxId` (contract offer) + `cantonUpdateId` bila ada.
2. **PostgreSQL** `CcTransaction` — sumber cepat untuk list & struk.
3. **Background** `backfillUpdateId` — scan stream `/v2/updates/transactions` untuk mengisi `cantonUpdateId` dari contract yang di-archive.
4. **Ledger indexer** (opsional, `LEDGER_INDEXER_ENABLED=true`) — set `settledAt` + `cantonUpdateId` saat TransferOffer di-archive.

## API

```http
GET /api/party/transactions/:id
Authorization: Bearer (cookie JWT)
```

Response: ringkasan DB + `ledgerEvents[]` + `cantonScanUrl`.

## Env

```env
CANTON_SCAN_TX_URL=https://www.cantonscan.com/tx/{updateId}
```

## Schema

`CcTransaction.cantonUpdateId` — ledger update ID (CantonScan).  
`CcTransaction.ledgerTxId` — contract / offer ID.

## Deploy

Setelah pull:

```bash
cd apps/api
npm run prisma:push
npm run prisma:generate
```

## Privasi

CantonScan hanya menampilkan metadata konsensus. Detail bisnis Daml tetap privat; internal explorer hanya menampilkan event yang visible untuk **party** user tersebut.
