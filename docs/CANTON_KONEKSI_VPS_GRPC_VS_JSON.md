# Canton: gRPC vs JSON API — VPS 1 ↔ VPS 2 (CanQuest)

Bahasa Indonesia. Referensi resmi:

- [Choose Your Path](https://docs.canton.network/appdev/get-started/choose-your-path)
- [Ledger API (gRPC vs JSON)](https://docs.canton.network/sdks-tools/api-reference/ledger-api)
- [JSON Ledger API](https://docs.canton.network/sdks-tools/api-reference/json-api)

---

## 1. Yang sering salah paham

| Klaim artikel umum | Fakta untuk CanQuest + Canton 3.x |
|--------------------|-----------------------------------|
| `npm install @daml/ledger` = gRPC | **Salah.** Paket [`@daml/ledger`](https://www.npmjs.com/package/@daml/ledger) = client **HTTP JSON API** (Daml 1.x), bukan gRPC mentah, dan **bukan** Canton `/v2/...` |
| Harus pakai port `5011` | Port tergantung deploy. Canton docs: **gRPC default 5001**, **JSON default 7575** |
| Wajib gRPC supaya tidak putus | Putus–nyambung biasanya **SSH tunnel** atau **node restart**, bukan karena pakai HTTP JSON |
| Browser tembak VPS 1 | **Tidak boleh.** Browser → Vercel → VPS 2 API → node (sudah benar) |

**CanQuest hari ini sudah pakai jalur yang Canton rekomendasikan untuk TypeScript:**

- NestJS → HTTP **JSON Ledger API v2** → `http://127.0.0.1:7575` (via tunnel ke participant)
- Wallet Splice → `http://127.0.0.1:8080` (via tunnel ke nginx)

Ini sama dengan **Opsi B** di artikel (JSON API), hanya JSON API-nya jalan **di dalam participant VPS 1**, bukan proxy terpisah di VPS 2.

---

## 2. Dua binding resmi Canton (participant node)

| | **gRPC** | **JSON (HTTP)** |
|--|----------|-----------------|
| Port default | **5001** | **7575** |
| Protokol | HTTP/2 + Protobuf | HTTP + REST `/v2/...` |
| Cocok untuk | Java, throughput tinggi | **Node.js, TypeScript**, curl, browser BFF |
| CanQuest | Belum dipakai | **Sudah** (`CantonLedgerService`) |

Kutipan resmi: untuk stack Node/TS, Canton menyarankan **JSON Ledger API**, bukan gRPC wajib.

---

## 3. Tiga cara VPS 2 → VPS 1 (pilih satu)

### Cara A — SSH tunnel (sekarang) ✅

```
VPS 2:127.0.0.1:7575 ──SSH──► participant Docker:7575
VPS 2:127.0.0.1:8080 ──SSH──► nginx Docker:80
```

**Plus:** aman, tidak buka port ledger ke internet.  
**Minus:** proses SSH bisa putus → terasa “node mati sebentar”.

**Perbaiki dulu (sebelum gRPC):**

```bash
# /etc/systemd/system/canton-tunnel.service
-o ServerAliveInterval=30
-o ServerAliveCountMax=3
-o TCPKeepAlive=yes
Restart=always
```

Monitor:

```bash
curl -sf http://127.0.0.1:7575/livez || systemctl restart canton-tunnel
```

---

### Cara B — HTTP langsung VPS 2 → VPS 1 (tanpa SSH) ⭐ sering lebih stabil

Participant JSON API hanya listen **di dalam Docker network** VPS 1. Bukan ke internet.

1. **VPN privat** antara VPS 2 (`62.171.185.56`) dan VPS 1 (`162.250.190.204`).
2. Atau firewall **hanya** dari IP VPS 2 ke port internal (jika participant bind ke IP host — jarang di Splice).

Di VPS 2 `.env`:

```env
# Ganti localhost jika lewat VPN ke IP private participant
CANTON_JSON_API_URL=http://10.x.x.x:7575
CANTON_VALIDATOR_URL=http://10.x.x.x:8080
```

**Tidak perlu** `@daml/ledger` — `CantonLedgerService` tetap pakai `fetch` ke `/v2/...`.

**Matikan** `canton-tunnel.service` kalau sudah tidak dipakai.

---

### Cara C — gRPC langsung (port 5001) 🔧 refactor besar

Hanya worth it jika:

- Tunnel/VPN tetap tidak stabil, dan
- Butuh streaming transaksi throughput tinggi, dan
- Tim siap maintain client gRPC + protobuf Canton v2.

**Bukan** `npm install @daml/ledger`. Perlu:

- Client gRPC (Java native, atau `@grpc/grpc-js` + proto Canton Ledger API v2), atau SDK seperti [`@fairmint/canton-node-sdk`](https://www.npmjs.com/package/@fairmint/canton-node-sdk) (JSON v2, lebih dekat ke CanQuest).

Di VPS 1 (contoh — **cek dulu port di deploy kamu**):

```bash
PARTICIPANT_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1)
ss -tlnp | grep -E '5001|7575'
```

Firewall (hanya dari VPS 2):

```bash
sudo ufw allow from 62.171.185.56 to any port 5001 proto tcp
```

**Splice wallet API (:8080) tetap terpisah** — gRPC tidak menggantikan validator HTTP.

---

## 4. Contoh kode (referensi)

### 4a. Yang CanQuest sudah lakukan (benar untuk Nest + Canton v2)

File: `apps/api/src/canton/canton-ledger.service.ts`

```typescript
// Pola resmi Module 4 — JSON Ledger API v2
const res = await fetch(`${this.baseUrl}/v2/commands/submit-and-wait`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(command),
});
```

`baseUrl` = `http://127.0.0.1:7575` (tunnel) atau IP VPN (Cara B).

---

### 4b. `@daml/ledger` — tidak disarankan untuk CanQuest

```typescript
// ⚠️ Legacy Daml 1.x JSON API — endpoint /v1/..., BUKAN Canton /v2/...
import { Ledger } from '@daml/ledger';
const ledger = new Ledger({ token, httpBaseUrl: 'http://127.0.0.1:7575', wsBaseUrl: 'ws://127.0.0.1:7575' });
```

Tidak cocok mengganti `CantonLedgerService` tanpa rewrite penuh ke OpenAPI Canton v2.

---

### 4c. gRPC + keep-alive (Node.js) — ilustrasi saja

Butuh proto + `@grpc/grpc-js`. Port dan service name sesuaikan participant.

```typescript
import * as grpc from '@grpc/grpc-js';

const GRPC_TARGET = '162.250.190.204:5001'; // atau IP VPN; CEK DI VPS 1

const channel = new grpc.Channel(
  GRPC_TARGET,
  grpc.credentials.createInsecure(), // production: TLS
  {
    'grpc.keepalive_time_ms': 30_000,
    'grpc.keepalive_timeout_ms': 10_000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.min_time_between_pings_ms': 10_000,
  },
);

// Client generated dari Canton Ledger API v2 .proto
// const client = new LedgerClient(GRPC_TARGET, credentials, { channelFactoryOverride: ... });
```

Ini **proyek terpisah** (mingguan), bukan config tunggal.

---

### 4d. HTTP keep-alive untuk `fetch` (tanpa gRPC)

Agar koneksi HTTP ke `7575` lebih stabil (masih JSON API):

```typescript
import { Agent, setGlobalDispatcher } from 'undici';

const agent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
  connections: 10,
});
setGlobalDispatcher(agent);
```

Bisa ditambahkan di bootstrap Nest — **tidak** mengganti arsitektur.

---

## 5. Alur website (tidak berubah)

```
Browser → https://www.canquest.cc/api/...
       → Vercel BFF
       → https://api.canquest.cc/api/...  (VPS 2 Nest)
       → 127.0.0.1:7575 / 8080 (tunnel atau VPN)
       → VPS 1 participant
```

Frontend **tidak** pernah ke IP validator. Itu sudah sesuai poin 4 artikel.

---

## 6. Rekomendasi untuk CanQuest

| Prioritas | Tindakan |
|-----------|----------|
| **1** | Perkuat `canton-tunnel` + monitor `livez` |
| **2** | Pertimbangkan **VPN privat** VPS2↔VPS1, HTTP langsung ke `7575` |
| **3** | `NODE_ENV=production`, pastikan JWT/WEB_ORIGIN benar |
| **4** | gRPC `5001` + refactor — **hanya** jika 1–3 tidak cukup |

**Jangan** ganti ke `@daml/ledger` saja — tidak solve tunnel drop dan tidak compatible `/v2`.

---

## 7. Tes port di VPS 1

```bash
PARTICIPANT_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1)

curl -s "http://${PARTICIPANT_IP}:7575/livez"
curl -s -H "Authorization: Bearer <JWT>" "http://${PARTICIPANT_IP}:7575/v2/version"

# Cek gRPC (dari VPS 2, setelah firewall / VPN)
nc -zv 162.250.190.204 5001
```

---

## 8. Ringkas

| Pertanyaan | Jawaban |
|------------|---------|
| Pakai `@daml/ledger`? | **Tidak** untuk CanQuest Canton v2 |
| Pakai gRPC 5011/5001? | **Opsional**, refactor besar |
| Kenapa putus–nyambung? | Perbaiki **tunnel/VPN**, bukan wajib gRPC |
| Stack TS resmi Canton? | **JSON API :7575** — sudah dipakai |

Lihat juga: [TUTORIAL_DEPLOY_INDONESIA.md](./TUTORIAL_DEPLOY_INDONESIA.md)
