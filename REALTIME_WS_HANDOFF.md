# 🔄 HANDOFF: Realtime WebSocket Canton — Status & Lanjutan

> **Dokumen ini untuk chat AI baru. Baca lengkap sebelum lanjut.**
> Tanggal awal: 2026-07-17 (sesi panjang, ~8 jam)
> **Update terakhir: 2026-07-18 — Q8 RESOLVED END-TO-END (lihat section atas).**
> Branch: `fix/realtime-ws-token-rights` → merged ke `master`.

---

## 🏆 UPDATE 2026-07-18: Q8 RESOLVED END-TO-END — WS JALAN PRODUCTION

> **Bagian ini menimpa status "Auth WS gagal" di bawah. Baca ini dulu, baru
> konteks historis di bawah untuk memahami root cause.**

### Status final (verified via PM2 + participant log)

| Komponen | Status |
|---|---|
| WS Canton `/v2/updates` | ✅ **JALAN PRODUCTION** — transaction events masuk (~2-5s) |
| Auth method | ✅ **Header `Authorization: Bearer <jwt>`** (bukan subprotocol JWT) |
| Proactive reconnect | ✅ **Trigger tepat ~240s** sesuai schedule (token expiry 300s) |
| Service-account rights | ✅ **`CanReadAsAnyParty` granted** ke UUID `fc334391-...-456f-...` |
| Frontend SSE listener | ✅ **`offer:new` re-applied** + safety-net polling 300s |
| Production safety | ✅ Fallback poller + polling tetap jalan; flag default OFF |

### Root cause asli (4 lapis, semuanya harus solve)

1. **TOKEN EXPIRED** — Token Keycloak lifetime 300s. WS stream pakai token SEKALI
   di `startStream()`. Canton validate token per-RPC → setelah 300s semua request
   gagal `ACCESS_TOKEN_EXPIRED`. Pesan ke client disembunyikan jadi `grpcCodeValue:16`.
2. **RIGHTS** — Service-account punya `ParticipantAdmin` tapi **tidak** `CanReadAsAnyParty`
   (orthogonal rights, terverifikasi via AI Canton). `ParticipantAdmin` ≠ read all party.
3. **SUBPROTOCOL JWT DI-STRIP** — `Sec-WebSocket-Protocol: daml.ws.auth, jwt.token.<jwt>`
   (2 values) → JWT ~1000+ karakter di subprotocol bikin request di-strip/drop di
   salah satu layer proxy. **Solusi: pindahkan token ke header `Authorization`.**
4. **ENUM transactionShape SALAH** — AI Canton bilang `LedgerEffects`, tapi enum JSON
   yang valid adalah `TRANSACTION_SHAPE_LEDGER_EFFECTS`. Cross-check dengan error
   decode Canton explicit.

### Commits di branch (merged ke master)

```
87a4247  feat(web): real-time SSE listener offer:new + safety-net polling 300s
bcbc897  fix(realtime): WS auth via Authorization header (bukan subprotocol JWT)
7b452be  fix(realtime): WS Canton /v2/updates — token expiry + CanReadAsAnyParty
```

### Lessons learned tambahan

7. **AI Canton bisa kontradiksi dirinya sendiri** (lagi): bilang enum `LedgerEffects`,
   ternyata harus `TRANSACTION_SHAPE_LEDGER_EFFECTS`. Bilang `@clients` suffix, ternyata
   data riil pakai UUID polos. Cross-check SEMUA jawaban AI dengan log participant.
8. **Body decode error vs auth error berbeda**: Canton kasih decode error EXPLICIT
   (e.g. "Unrecognized enum value LedgerEffects. Supported values: [...]"), tapi auth
   error di-MASK jadi "security-sensitive". Untuk debug auth, HARUS ambil participant
   log (VPS 1) — bukan tebak dari client error.
9. **`filtersForAnyParty` (wildcard) jalan untuk WS path** — terverifikasi via wscat
   + PM2 log. Tidak perlu enumerate party user di subscribe time. Routing per-event
   via `witnessParties` (pre-compute Canton) → lookup user DB → dispatch SSE.
10. **JWT panjang di subprotocol header tidak reliable lewat proxy chain** (Cloudflare /
    nginx / pekko-http). Token auth WS lebih robust via `Authorization: Bearer` header.

### Commands penting (post-fix)

**Verify WS jalan di production:**
```bash
# VPS 2
pm2 logs canquest-api --lines 50 --nostream | grep -iE "cantonupdates|ws message"
# Harus muncul: "WS connected" + "WS message received (...Transaction...)"
```

**Emergency stop WS:**
```bash
sed -i 's/^CANTON_UPDATES_WS_ENABLED=.*/CANTON_UPDATES_WS_ENABLED=false/' /var/www/canquest/apps/api/.env
pm2 restart canquest-api --update-env
```

**Re-grant CanReadAsAnyParty (kalau hilang):**
```bash
# VPS 2
LEDGER_CLIENT_ID=$(grep -E '^LEDGER_CLIENT_ID=' /var/www/canquest/apps/api/.env | head -1 | cut -d= -f2- | tr -d '"'"'"'')
LEDGER_CLIENT_SECRET=$(grep -E '^LEDGER_CLIENT_SECRET=' /var/www/canquest/apps/api/.env | head -1 | cut -d= -f2- | tr -d '"'"'"'')
ADMIN_TOKEN=$(curl -s -X POST https://auth.canquestlabs.com/realms/canton/protocol/openid-connect/token \
  -d "grant_type=client_credentials" -d "client_id=$LEDGER_CLIENT_ID" \
  -d "client_secret=$LEDGER_CLIENT_SECRET" -d "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -s -X POST "https://ledger.canquestlabs.com/v2/users/fc334391-0f6a-456f-bb95-098b269e62b6/rights" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"fc334391-0f6a-456f-bb95-098b269e62b6","rights":[{"kind":{"CanReadAsAnyParty":{"value":{}}}}]}'
```

---

## 🎯 GOAL AWAL USER (konteks historis)

DApp (Next.js di Vercel + NestJS di VPS 2) terlalu banyak polling (`refetchInterval`), datanya "acak-acakan". User ingin rapikan pakai **Real-Time WebSocket Canton** sesuai dokumentasi resmi (`wss://ledger.canquestlabs.com/v2/updates`), ganti polling dengan invalidasi via SSE.

Dikerjakan 2 fase:
- **Fase 1**: Investigasi read-only (selesai, laporan lengkap di chat)
- **Fase 2**: Implementasi (kode ditulis, deploy, debug infrastruktur)

---

## 📊 STATUS SAAT INI (PRODUCTION AMAN)

| Komponen | Status | Catatan |
|---|---|---|
| Web (Vercel) | ✅ **STABIL** | Frontend revert ke commit `5f19533` (polling 30s, state pre-Fase-2) |
| Backend VPS 2 | ✅ **SEHAT** | `CANTON_UPDATES_WS_ENABLED=false`, poller lama (CcInboundSync 30s + OfferReconciler 60s) jadi fallback |
| Infrastruktur WS | ✅ **JALAN** | `curl upgrade` dari VPS 2 ke `ledger.canquestlabs.com/v2/updates` → **101 OK** (Q8 berbulan-bulan RESOLVED) |
| **Auth WS** | ⏸️ **GAGAL — TERSISA** | `grpcCodeValue:16 UNAUTHENTICATED` walau 4x percobaan format berbeda |

**Tidak ada fire.** Production stabil. WS cuma "nice to have" — data tetap sinkron via polling.

---

## 🗺️ TOPOLOGI (3 VPS + Cloudflare)

```
VPS 2 (app, hostname: vmi3309107)
  └─ NestJS backend: /var/www/canquest/apps/api
     ├─ PM2 process: canquest-api (port 3001, loopback)
     ├─ .env (REAL values, JANGAN commit): LEDGER_API_URL, KEYCLOAK_*, LEDGER_CLIENT_SECRET
     └─ CantonUpdatesService: WS consumer (code ready, flag OFF)

VPS 1 (node, hostname: ubuntu)
  └─ ~/splice-node/docker-compose/validator/
     ├─ Canton participant (docker): canton-participant:0.6.10, port 7575 (JSON API), 5001 (gRPC)
     ├─ Keycloak container (canton-keycloak, port 8080)
     ├─ Docker nginx (port 80, file: ~/splice-node/docker-compose/validator/nginx.conf)
     └─ Host nginx (port 443, file: /etc/nginx/sites-available/ledger.canquestlabs.com)

Vercel
  └─ Next.js frontend: apps/web (auto-deploy dari master)

Cloudflare
  └─ Di depan: ledger.canquestlabs.com, auth.canquestlabs.com, validator.canquestlabs.com, canquest.cc
```

**Domains (production, sudah benar):**
- `auth.canquestlabs.com` → Keycloak (realm **`canton`**, BUKAN `AppUser`)
- `ledger.canquestlabs.com` → Canton JSON Ledger API (REST + WS)
- `validator.canquestlabs.com` → Splice Validator REST
- `api.canquest.cc` → app backend (VPS 2)
- `www.canquest.cc` → frontend (Vercel)

---

## 🔬 HASIL VERIFIKASI (FAKTA TERBUKTI, BUKAN TEBAKAN)

### WS infrastruktur — ✅ JALAN
- `curl upgrade` **langsung** ke `participant:7575` dari dalam container → `101 Switching Protocols` + `Sec-WebSocket-Protocol: daml.ws.auth`
- `curl upgrade` dari **VPS 2** lewat domain publik → `101 Switching Protocols` (setelah nginx fix)
- Canton `0.6.10` support WS by default (tidak perlu config tambahan)

### Auth WS — ❌ GAGAL dengan 4 metode
| # | Metode | Hasil |
|---|---|---|
| 1 | Token via `Sec-WebSocket-Protocol: daml.ws.auth, jwt.token.<jwt>` (nginx belum forward) | `grpcCodeValue:16 UNAUTHENTICATED` |
| 2 | Token via subprotocol + nginx forward `Sec-WebSocket-Protocol` header | `grpcCodeValue:16 UNAUTHENTICATED` (masih gagal!) |
| 3 | Token via WS message pertama `jwt.token.<jwt>` | `LEDGER_API_INTERNAL_ERROR: Cannot decode frame: Text(jwt.token...)` (participant expect JSON, bukan token string) |

### Yang PASTI valid (cross-check)
- **Token JWT Keycloak VALID** — REST `POST /v2/updates` pakai token yang SAMA → `200 OK` (kalau audience salah, REST juga gagal)
- Token: Keycloak client_credentials, scope `daml_ledger_api`, aud `[http://wallet.localhost/api, https://canton.network.global, account]`, client `validator-app-backend`
- Pesan error participant samar: `"A security-sensitive error has been received"` (Canton sembunyikan detail)

### Kontradiksi AI Canton (HATI-HATI)
AI Canton **kontradiksi dirinya sendiri** soal tipe `beginExclusive`:
- Tanya ke-1: *"WAJIB integer, bukan string"*
- Tanya ke-3: *"Tipe string, bukan integer"*
- **Saat ini kode pakai integer** (Number). Belum dikonfirmasi salah/benar — tapi error UNAUTHENTICATED muncul SEBELUM request body dievaluasi (jadi tipe beginExclusive BUKAN penyebab close 1000).

---

## 📦 STATE KODE DI REPO (master)

### Commit history (yang relevan)
```
da8c6b5  fix(realtime): revert ke subprotocol auth ← STATE SAAT INI (backend)
4206f50  revert(web): 8 file frontend ke 5f19533   ← STATE SAAT INI (frontend)
c89dc0c  fix(realtime): auth via message (SALAH — sudah revert di da8c6b5)
e700085  fix(realtime): diagnostik payload + cegah infinite reconnect loop
6d4e4aa  fix(realtime): beginExclusive integer (close 1000)
162c6d8  fix(realtime): WS auth via subprotocol (tebakan salah, tapi kode dasar di sini)
290e2b0  feat(realtime): Fase 2 awal — WS native rewrite + frontend hooks
5f19533  ← BASELINE STABIL (frontend revert ke sini)
```

### File penting
- `apps/api/src/canton/canton-updates.service.ts` — **WS consumer utama** (kode ready, flag OFF). Punya diagnostik `WS sending subscription request` + `WS message received` + reconnect counter reset di `handleStreamLine` (cegah infinite loop).
- `apps/api/src/auth/keycloak-token.service.ts` — Token cache (pre-emptive refresh 60s, single-flight). Secret AMAN di sini, tidak pernah ke frontend.
- `apps/api/src/canton/canton-ledger.service.ts` — REST client. **Reference auth yang JALAN** (`authHeaders()` line 145-154, inject `Bearer` per-call).
- `apps/api/src/canton/offer-reconciler.service.ts` — Sudah emit SSE `transaction:new` + `balance:changed` ke SENDER saat offer settled externally.
- `apps/api/src/realtime/realtime.service.ts` — SSE push ke browser (`@Global`, single PM2 instance).
- `apps/web/lib/realtime/use-realtime.ts` — Hook SSE browser. **Frontend revert = listener `offer:new` BELUM ada** (dihapus saat revert).
- `apps/web/components/app/wallet/offers-section.tsx` — `useOffers` + `useSentOffers`, polling 30s (state pre-Fase-2).

### Frontend Fase 2 (yang harus di-reapply kalau WS auth solved)
File-file yang sudah jadi di commit `290e2b0` (bisa `git cherry-pick` atau re-apply manual):
- `apps/web/lib/realtime/use-realtime.ts` — tambah listener `offer:new`
- `apps/web/components/app/wallet/offers-section.tsx` — hapus `refetchInterval` offers
- `apps/web/components/app/wallet/transactions-view.tsx` — hapus `refetchInterval` transactions
- `apps/web/lib/hooks/use-transaction-notifications.ts` — hapus `refetchInterval` notifications
- `apps/web/lib/hooks/use-lock-status.ts` — perpanjang jadi 300s
- `apps/web/lib/hooks/use-token-prices.ts` — perpanjang jadi 300s

---

## 📁 STATE INFRASTRUKTUR (VPS 1)

### Nginx host `/etc/nginx/sites-available/ledger.canquestlabs.com` — ✅ SUDAH DIEDIT
Ada 3 penambahan (jangan dihapus):
```nginx
# Di block http {} /etc/nginx/nginx.conf (host):
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Di location / {} ledger.canquestlabs.com:
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Sec-WebSocket-Protocol $http_sec_websocket_protocol;
proxy_read_timeout 86400s;
```
Backup: `/etc/nginx/sites-available/ledger.canquestlabs.com.bak.20260717` dan `/etc/nginx/nginx.conf.bak.20260717`.

### Docker nginx `~/splice-node/docker-compose/validator/nginx.conf` — ✅ SUDAH DIEDIT
Block `json-ledger-api.localhost` sudah punya WS headers + `Sec-WebSocket-Protocol` forward + map `$connection_upgrade` di `http {}`.
Backup: `~/splice-node/docker-compose/validator/nginx.conf.bak.20260717`.

### Config .nodelab.my.id lama
3 file di `/etc/nginx/sites-available/` (api-canquest, api-ledger-canquest, oauth-canquest) — **sudah tidak ter-enable** (tidak ada symlink di sites-enabled). Belum dipindah ke backup (todo kerapian, low priority).

---

## 🎯 TODO BESOK — MULAI DARI SINI

### Prioritas: Debug auth WS dengan DATA (bukan tebakan)

**Langkah 1 — Ambil log participant Canton (di VPS 1)** — INI PALING PENTING:
```bash
cd ~/splice-node/docker-compose/validator
# Aktifkan WS dulu biar ada log fresh
# (di VPS 2: set CANTON_UPDATES_WS_ENABLED=true + pm2 restart)
# Lalu di VPS 1, capture log participant saat WS connect attempt:
docker compose logs participant --tail 200 2>/dev/null | grep -iE "auth|token|jwt|unauth|websocket|permission|CanReadAs|denied|error" | tail -40
```
**Yang dicari:** error auth ASLI dari participant (bukan "security-sensitive error" yang samar). Canton menyembunyikan detail ke client, tapi log internal participant biasanya lebih verbose.

**Langkah 2 — Decode JWT (di VPS 2)** untuk bandingkan claim:
```bash
# Ambil token fresh
curl -s -X POST https://auth.canquestlabs.com/realms/canton/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=$LEDGER_CLIENT_ID" \
  -d "client_secret=$LEDGER_CLIENT_SECRET" \
  -d "scope=daml_ledger_api" | jq -r .access_token > /tmp/jwt.txt
# Decode header + payload (paste ke jwt.io atau command):
cat /tmp/jwt.txt | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```
Cek: `iss`, `aud`, `sub`, `exp`, `resource_access`, scope. Bandingkan dengan yang participant expect (`CANTON_LEDGER_API_AUDIENCE` di env participant).

**Langkah 3 — Cek config participant** untuk audience/permission:
```bash
# Di VPS 1
docker compose exec participant env | grep -iE "audience|auth|ledger"
docker compose exec participant cat /app/canton-participant*.conf 2>/dev/null | grep -iA5 "auth\|jwt\|audience"
```

**Langkah 4 — Tanya AI Canton** soal perbedaan validasi WS vs REST (BUKAN format auth lagi — itu sudah verified):
> Token JWT Keycloak saya (client_credentials, scope daml_ledger_api, aud https://canton.network.global) **berhasil untuk REST** (POST /v2/updates → 200 OK), tapi **gagal untuk WebSocket** dengan `grpcCodeValue:16 UNAUTHENTICATED`. Token dikirim via `Sec-WebSocket-Protocol: daml.ws.auth, jwt.token.<jwt>`. Apakah participant **memvalidasi token WS berbeda** dari REST? (mis. WS butuh claim `sub` spesifik, permission `CanReadAsAnyParty`, atau token per-party?) Bagaimana cara melihat error auth asli di log participant?

---

## 💡 PLAN B (kalau auth WS terlalu rumit)

**Revert `CantonUpdatesService` ke HTTP long-poll REST** (yang asli jalan di commit `5f19533`):
- Pakai `POST /v2/updates` REST — auth sudah terbukti jalan (token sama → 200 OK)
- Real-time tidak secepat WS (poll 10s), tapi **TIDAK ADA masalah auth**
- Tetap bisa emit SSE `offer:new` saat reconcile detect perubahan
- Frontend Fase 2 tetap bisa di-apply (listener SSE tidak peduli transport backend)

Ini **opsi solid** kalau setelah Langkah 1-4 di atas auth WS masih gagal.

---

## ⚠️ HAL YANG TIDAK BOLEH DIULANG (LESSONS LEARNED)

1. **Jangan nebak format auth WS lagi.** 4x gagal. Selalu verifikasi dengan data participant log dulu.
2. **`CANTON_UPDATES_WS_ENABLED=true` tanpa WS fix = infinite reconnect loop spam log.** Selalu set `false` dulu saat debug.
3. **AI Canton bisa kontradiksi dirinya sendiri** (lihat kasus `beginExclusive` integer vs string). Cross-check dengan data riil.
4. **Vercel deploy bisa trigger EnvFileReadError** yang tidak ada hubungannya dengan kode. Cek Vercel dashboard Settings → Environment Variables, bukan salahkan kode.
5. **Backend VPS 2 ≠ VPS 1 node.** `.env` ada di VPS 2, docker/log participant ada di VPS 1. Jangan campur.
6. **Rollback Vercel via UI** (Promote to Production deployment lama) lebih cepat dari git revert untuk web emergency.

---

## 🔧 COMMAND CEPAT (untuk referensi)

### Matikan WS (emergency stop spam log)
```bash
# VPS 2
sed -i 's/^CANTON_UPDATES_WS_ENABLED=.*/CANTON_UPDATES_WS_ENABLED=false/' /var/www/canquest/apps/api/.env
pm2 restart canquest-api --update-env
```

### Nyalakan WS
```bash
# VPS 2
sed -i 's/^CANTON_UPDATES_WS_ENABLED=.*/CANTON_UPDATES_WS_ENABLED=true/' /var/www/canquest/apps/api/.env
pm2 restart canquest-api --update-env
pm2 logs canquest-api --lines 50 --nostream | grep -i "canton\|ws"
```

### Deploy backend baru
```bash
# VPS 2
cd /var/www/canquest/apps/api && git pull origin master && npm run build && pm2 restart canquest-api --update-env
```

### Reload nginx
```bash
# VPS 1 host nginx
nginx -t && systemctl reload nginx

# VPS 1 docker nginx
cd ~/splice-node/docker-compose/validator
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
```

### Test WS probe dari VPS 2
```bash
curl -sS -D - -o /dev/null --http1.1 --max-time 10 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Protocol: daml.ws.auth" \
  "https://ledger.canquestlabs.com/v2/updates"
```

### Test WS langsung ke participant (bypass nginx, di VPS 1)
```bash
cd ~/splice-node/docker-compose/validator
docker compose exec nginx bash -c 'apt-get install -y curl >/dev/null 2>&1 || true; curl -sS -D - -o /dev/null --http1.1 --max-time 5 \
  -H "Host: json-ledger-api.localhost" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Protocol: daml.ws.auth" \
  http://participant:7575/v2/updates'
```

---

## 📝 KONTEKS RALAT (PENTING UNTUK CHAT BARU)

1. **Sesi ini melakukan banyak debugging trial-and-error.** Beberapa commit (`c89dc0c`) berisi tebakan yang SALAH dan sudah di-revert di `da8c6b5`. Jangan ikuti tebakan lama.
2. **Kode `da8c6b5` adalah baseline yang valid** — WS consumer siap pakai, tinggal masalah auth di sisi participant.
3. **Frontend revert (`4206f50`) adalah KEPUTUSAN SENGAJA** untuk stabilkan production saat Vercel error. Bukan bug.
4. **User (Bang Pateng) sangat hati-hati** dan sudah beberapa kali push back saat AI nebak. Hormati skeptisme ini — verifikasi dengan data sebelum ngoding.
5. **User komunikatif dan sabar** meski sesi panjang. Kasih jawaban jujur, jangan defense.
6. **Pesan terakhir user sebelum handoff**: "aku akan lanjut di chat baru tapi saya pastikan chat baru mengerti konteks."

---

**Selamat melanjutkan. Mulai dari section "TODO BESOK" di atas.**
