# Spesifikasi "Bagaimana Seharusnya" — Realtime Data On-chain di CanQuest

> Tujuan dokumen: didokumentasikan dengan jelas arsitektur realtime yang **seharusnya**
> dipakai dapp Canton CanQuest, lalu diverifikasi ke AI Canton / dokumentasi resmi.
> Lihat bagian **"Pertanyaan untuk AI Canton"** di bawah.

---

## 1. Konteks dapp (untuk referensi AI Canton)

| Item | Nilai |
|---|---|
| Platform | **Canton Network** (Digital Asset) |
| Participant node | **v3.5.6** (terverifikasi via `curl` ke `api-ledger-canquest.nodelab.my.id`) |
| Ledger API | `https://api-ledger-canquest.nodelab.my.id` (Canton JSON Ledger API v2) |
| Validator API | `https://api-canquest.nodelab.my.id` (Splice Validator REST, CIP-56) |
| Token utama | **CC / Amulet** (Canton Token Standard, CIP-56 TransferFactory) + USDCx + CBTC via Cantex DEX |
| Auth ledger | Keycloak OIDC `client_credentials`, token admin ~5 menit expiry |
| Backend | NestJS REST, prefix `/api`, bind `127.0.0.1` |
| Indexer off-chain | PostgreSQL/Prisma + Modo Transfer API (poll 15s) |
| Frontend | Next.js 15 + TanStack Query (SSE push dari backend) |

---

## 2. Arsitektur YANG SEHARUSNYA (target state)

### Prinsip utama (sesuai dokumen Canton: Performance Optimization)

1. **Satu sumber realtime: stream `/v2/updates`** (HTTP/2 server-streaming, bukan polling).
2. **Polling hanya fallback / safety-net**, interval **panjang** (≥ 5 menit), bukan sumber utama.
3. **Query ACS** (`/v2/state/active-contracts`) hanya saat **cold start** atau **reconcile ekplisit**, tidak per-N-detik.
4. **Offset tracking** wajib: simpan offset terakhir → resume dari situ (no lost, no duplicate event).
5. **Idempotency** wajib di semua handler (stream bisa re-deliver saat reconnect).

### Alur ideal

```
Ledger event (transfer CC, offer settle, lock)
        │
        ▼
  /v2/updates stream  (1 koneksi admin, subscribe semua party user)
        │
        ▼
  CantonUpdatesService → dispatch via rxjs Subject (debounce 2s per party)
        │
        ├──► CcInboundSyncService.reconcileParty(partyId)  → update balance + TRANSFER_IN
        └──► OfferReconcilerService.reconcileParty(partyId) → settle offer
        │
        ▼
  RealtimeService SSE → browser (frontend langsung daptar update < 3 detik)

  [BACKGROUND FALLBACK]
  CcInboundSync poller: setiap 5 MENIT (bukan 30 detik, bukan 2 menit)
  Modo indexer        : setiap 15 detik (settle transaksi by updateId) — ini tetap, karena Modo
                        adalah sumber truth finality cross-domain, bukan duplicate work.
```

### Latency yang diharapkan setelah benar

| Operasi | Sekarang (worst case) | Target |
|---|---|---|
| User A kirim CC → User B lihat balance naik | **~2 menit** (poller 120s) | **< 3 detik** (via stream) |
| Offer settle terdeteksi | ~60 detik (OfferReconciler poll) | **< 3 detik** (via stream) |
| Transfer dari validator eksternal | 2 menit | **< 3 detik** |

---

## 3. Kondisi SAAT INI di kode (gap analysis)

Sumber latency dapp saat ini **bukan desain Canton**, tapi kombinasi flag env yang konservatif:

| Komponen | File | Default code | Setting `.env` aktual | Status |
|---|---|---|---|---|
| Stream `/v2/updates` | `canton-updates.service.ts:138` | `CANTON_UPDATES_WS_ENABLED` default **false** | **tidak diset** → false | ❌ MATI |
| CC inbound poller | `cc-inbound-sync.service.ts:60` | 30 detik | `CC_INBOUND_SYNC_POLL_MS=120000` (**2 menit**) | ⚠️ terlalu lambat |
| Modo indexer | `ledger-indexer.service.ts:70` | 15 detik | 15 detik | ✅ OK |

### Yang sudah benar (tidak perlu diubah)

- ✅ `CantonUpdatesService` sudah implementasi offset tracking + reconnect exponential backoff.
- ✅ Auth pakai single admin token dengan `CanReadAs` per-party (bukan `CanReadAsAnyParty`, yang memang butuh permission lain — HTTP 403 terverifikasi).
- ✅ Filter pakai `filtersByParty` dengan list party eksplisit dari DB (filter kosong → 400, `filtersForAnyParty` → 403).
- ✅ Dispatch via rxjs Subject dengan debounce 2 detik per party (coalesce burst event).
- ✅ Handler sudah didesain idempoten (`reconcileParty` aman dipanggil berkali-kali).
- ✅ Token refresh otomatis tiap reconnect (KeycloakTokenService pre-emptive refresh 60s sebelum expiry).

### Yang perlu diperbaiki

1. **Nyalakan stream** — set `CANTON_UPDATES_WS_ENABLED=true` di `.env`.
2. **Turunkan poller jadi safety-net** — set `CC_INBOUND_SYNC_POLL_MS=300000` (5 menit).
3. Setelah stream stabil di produksi (observasi 1–2 minggu), opsi: `CC_INBOUND_SYNC_POLL_ENABLED=false` untuk matikan poller total.

---

## 4. Pertanyaan untuk AI Canton / dokumentasi resmi

> Tolong bawa pertanyaan-pertanyaan berikut ke AI Canton atau cek di
> https://docs.canton.network/appdev/deep-dives/performance-optimization
> untuk verifikasi. Sertakan konteks di section 1.

### Q1 — Apakah `/v2/updates` HTTP/2 server-stream adalah cara recommended untuk realtime consumer di Canton participant node v3.5.6?

Kami membaca bahwa `/v2/updates` **bukan WebSocket upgrade klasik**, melainkan HTTP/2 server-streaming (POST satu request, server kirim multiple JSON object di body, lalu EOF).

- Apakah ini benar transport yang dimaksud, atau ada endpoint WebSocket native (`/v2/updates/stream` / gRPC `UpdateStreamService`) yang lebih efisien?
- Untuk near-realtime (< 3 detik), apakah recommended:
  - (a) one-shot POST + re-request tiap EOF (long-poll), atau
  - (b) HTTP/2 keep-alive stream yang tetap terbuka tanpa EOF?
- Apakah ada limit durasi koneksi (misal server otomatis close setelah N menit) yang perlu kami tangani di reconnect logic?

### Q2 — Filter permission untuk admin token

Kami pakai Keycloak `client_credentials` dengan token admin yang punya `CanReadAs` per-party. Kami temukan:

- `filtersForAnyParty` (WildcardFilter tanpa party) → **HTTP 403**.
- `filtersByParty` dengan list party eksplisit → **bekerja**.

Pertanyaan:

- Apakah 403 di `filtersForAnyParty` memang by-design untuk token non-superuser?
- Untuk aplikasi multi-tenant dengan ratusan party user, apakah recommended pattern adalah **load party list dari DB + rebuild `filtersByParty` tiap reconnect** (yang kami lakukan sekarang), atau ada cara lebih efisien (mis. subscribe wildcard + filter client-side)?
- Berapa maksimum party dalam satu `filtersByParty` request sebelum performance drop?

### Q3 — Offsets & resume semantics

- Apakah offset `/v2/updates` **monotonik global** atau per-party?
- Setelah reconnect dengan `begin` = offset terakhir (exclusive), apakah dijamin **tidak ada event yang hilang** di window antara disconnect dan reconnect? Atau ada race yang memerlukan reconcile penuh setelah gap?
- Berapa lama offset tetap valid untuk resume? (Apakah ada GC offset ledger yang bisa buat offset lama invalid?)

### Q4 — Polling ACS sebagai fallback: interval yang wajar?

Dokumen bilang "hindari query ACS berulang". Tapi kami tetap butuh safety-net untuk kasus:

- stream disconnect lama (ledger maintenance, network blip),
- bug di handler yang skip event,
- multi-instance API (PM2 cluster) yang bisa miss event saat restart.

Pertanyaan:

- Apakah **poll reconcile full balance setiap 5 menit** sebagai safety-net acceptable, atau dianggap anti-pattern?
- Adakah pattern recommended untuk **gap detection** (mis. compare ledger-end offset vs last processed offset, trigger reconcile kalau gap > N)?

### Q5 — Multi-instance (PM2 cluster) + stream

Backend kami berjalan di PM2 (saat ini single fork, tapi mungkin scale). Kalau 2+ instance API sama-sama subscribe `/v2/updates` dengan admin token yang sama:

- Apakah akan ada double-delivery event (semua instance dapat event sama)? → kami kira iya, jadi handler idempoten.
- Adakah pattern recommended untuk **leader election** (hanya 1 instance subscribe stream, dispatch ke lainnya via Redis pub/sub)? Apakah Canton memberikan primitive untuk ini, atau kerja aplikasi?

### Q6 — Cantex swap latency

Swap kami: transfer CC on-ledger → Cantex intent (off-chain) → credit via WS. Total 8 langkah serial.

- Apakah ini memang tidak bisa di-batch di satu transaksi Canton?
- Untuk feedback ke user, adakah endpoint yang bisa kasih status intermediate (mis. "transfer submitted", "intent accepted", "settling") yang bisa kami stream, atau harus poll tiap langkah?

### Q7 — Modo indexer vs `/v2/updates`

Kami pakai Modo Transfer API (`api.modo.link/canton-mainnet`, poll 15s) untuk settle transaksi berdasarkan `updateId`.

- Apakah Modo adalah sumber finality cross-domain yang berbeda dari `/v2/updates` (sehingga wajar tetap dipertahankan), atau redundant?
- Kalau `/v2/updates` sudah cukup untuk finality on-ledger, kapan kami masih perlu query Modo?

### Q8 — KRITIS: Endpoint mana yang WebSocket native? (inkonsistensi transport)

**Konteks:** Setelah verifikasi ke AI Canton (Juli 2026), dikonfirmasi bahwa stream `/v2/updates` **memang WebSocket native** dan direkomendasikan, dengan referensi asyncapi di `/reference/json-api-asyncapi-reference/operations/v2-updates/subscribe`.

Tapi implementasi kami saat ini (file `apps/api/src/canton/canton-updates.service.ts`) **bukan WebSocket**, melainkan **HTTP POST one-shot yang di-re-request tiap 10 detik (long-poll pattern)**. Ada inkonsistensi internal di kode:

| Lokasi di kode | Apa yang ditulis |
|---|---|
| Comment baris 11-13 | "/v2/updates BUKAN classic WebSocket upgrade. Ini HTTP/2 server-streaming" |
| Comment baris 332 | "Canton `/v2/updates/stream` mengirim object JSON..." (menyebut `/stream`) |
| Implementasi baris 302 | `fetch('/v2/updates', { method: 'POST' })` (pakai `/v2/updates`, **tanpa** `/stream`) |
| Comment baris 357-359 | "one-shot request... tunggu POLL_INTERVAL_MS lalu re-request (long-poll pattern)" |

Pertanyaan:

1. **Endpoint mana yang benar untuk WebSocket native?** Pilihan yang kami temukan di dokumentasi:
   - `POST /v2/updates` (yang kami pakai sekarang — one-shot HTTP)
   - `GET /v2/updates/stream` (HTTP/2 server-stream, keep-alive, push-driven)
   - WebSocket subscribe via asyncapi `/reference/json-api-asyncapi-reference/operations/v2-updates/subscribe`
   
   Mana yang recommended untuk near-realtime (< 1 detik)?

2. **Apakah endpoint yang kami pakai sekarang (`POST /v2/updates`) benar-benar one-shot?**
   Kami observasi: response body EOF setelah semua update yang ada dikirim, lalu kami re-request tiap 10 detik. Apakah ini perilaku yang dimaksud, ataukah seharusnya koneksi tetap terbuka (long-lived) dan server push event baru seiring ledger update?

3. **Format payload stream**:
   - Apakah newline-delimited JSON (NDJSON) seperti yang kami parse sekarang?
   - Atau Server-Sent Events (`data: {...}\n\n`)?
   - Atau framing WebSocket binary/JSON message?

4. **Auth di WebSocket**: apakah pakai Bearer token di header (seperti HTTP POST kami), atau query param `?token=...` / subprotocol header (karena WS handshake tidak support custom header di browser)?

5. **Latency yang diharapkan** untuk masing-masing transport, pada participant node v3.5.6 dengan database sequencer?

> Catatan internal: jawaban Q8 menentukan apakah kami perlu rewrite
> `CantonUpdatesService.consumeStream()` dan mengganti endpoint, atau cukup
> menyalakan flag `CANTON_UPDATES_WS_ENABLED` saja.

---

## 5. Decision matrix setelah jawaban Q1–Q7

| Flag env | Sekarang | Target (Quick Win) | Target (Setelah verifikasi) |
|---|---|---|---|
| `CANTON_UPDATES_WS_ENABLED` | (unset → false) | `true` | `true` |
| `CC_INBOUND_SYNC_POLL_MS` | `120000` | `30000` | `300000` |
| `CC_INBOUND_SYNC_POLL_ENABLED` | (unset → true) | `true` | `false` (stream stabil) |
| `LEDGER_INDEXER_POLL_INTERVAL_MS` | `15000` | `15000` | (tergantung Q7) |

---

## 6. Referensi kode (untuh verifikasi internal)

- `apps/api/src/canton/canton-updates.service.ts` — stream consumer + dispatch
- `apps/api/src/canton/cc-inbound-sync.service.ts` — balance sync poller + on-demand reconcile
- `apps/api/src/canton/canton-ledger.service.ts` — Canton JSON Ledger API client
- `apps/api/src/canton/splice-validator.service.ts` — Splice Validator REST (CIP-56)
- `apps/api/src/canton/offer-reconciler.service.ts` — offer settlement
- `apps/api/src/ledger-indexer/ledger-indexer.service.ts` — Modo indexer poller
- `apps/api/src/realtime/realtime.service.ts` — SSE push ke browser
- `apps/api/.env` — konfigurasi aktual (baris 55, 65, 92, 96, 191)
