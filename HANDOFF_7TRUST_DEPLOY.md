# HANDOFF — Deploy 7TRUST Credential Service di VPS 1

> **Tujuan dokumen:** Resume pekerjaan deploy 7TRUST Domain Verification Client
> di chat baru tanpa kehilangan konteks.
> Sertakan dokumen ini (atau paste isinya) di awal chat baru.
>
> **Tanggal:** 2026-08-05
> **Target host:** VPS 1 (Canton participant node, bukan VPS 2)
> **Repo:** C:\Users\Bang Pateng\Documents\can (master)
> **Commit saat ini:** `cd8ae9f` (diag SETTLE_DEBUG)

---

## 0. CARPA MEMULAI CHAT BARU

Paste ini di awal chat baru:

```
Saya mau deploy 7TRUST Credential Service (Domain Verification Client)
di VPS 1 (Canton participant node). Detail lengkap ada di file
HANDOFF_7TRUST_DEPLOY.md di root repo.

Singkatnya: ada 3 langkah dari 7TRUST — (1) deploy DAR, (2) deploy Docker
client app, (3) first login + DNS verification. Tolong baca
HANDOFF_7TRUST_DEPLOY.md utk detail infrastruktur & env yang sudah saya
punya, lalu bantu saya eksekusi step by step.

Branch master, commit terakhir cd8ae9f.
```

---

## 1. APA ITU 7TRUST (ringkasan dari guide 7TRUST)

7TRUST Credential Service = domain verification client untuk Canton Network.
Fungsinya: verifikasi bahwa organisasi Anda control domain yang linked
ke Canton Party ID Anda → terbit credential on-chain.

**3 langkah deploy (dari guide resmi 7TRUST):**

1. **Deploy DAR** — download DAR dari GitHub C7, upload ke Canton participant node
2. **Deploy Client App** — Docker image `ghcr.io/c7-digital/7trust-client` (test/prod)
3. **First Login + DNS Verification** — login via OIDC, accept T&C, DNS verify domain

**Source guide:** 7trust.c7.digital · support@c7.digital

---

## 2. INFRASTRUKTUR VPS 1 (yang sudah Anda punya)

### Topologi (dari REALTIME_WS_HANDOFF.md)

```
VPS 1 (node, hostname: ubuntu, IP 162.250.191.195)
  └─ ~/splice-node/docker-compose/validator/
     ├─ Canton participant (docker): canton-participant:0.6.10
     │    port 7575 (JSON API), 5001 (gRPC)
     ├─ Keycloak container (canton-keycloak, port 8080)
     ├─ Docker nginx (port 80)
     └─ Host nginx (port 443)
         /etc/nginx/sites-available/ledger.canquestlabs.com

VPS 2 (backend, IP 62.171.185.56)
  └─ /var/www/canquest (NestJS API via PM2)
```

### Domain (live production, Cloudflare in front)

| Domain | Service |
|---|---|
| `ledger.canquestlabs.com` | Canton JSON Ledger API (REST + WS), port 7575 |
| `auth.canquestlabs.com` | Keycloak (realm **canton**) |
| `validator.canquestlabs.com` | Splice Validator REST |
| `canquest.cc` | App (Vercel + VPS2) |

⚠️ **JANGAN pakai domain `nodelab.my.id`** — itu legacy/legacy gateway yang di-deprecate. Pakai `canquestlabs.com`.

### Akses ke JSON Ledger API

```
Public:   https://ledger.canquestlabs.com/v2/...
Internal: http://172.18.0.5:7575/v2/...  (Docker IP participant)
```

### Auth Keycloak (production mode)

```
LEDGER_AUTH_MODE=keycloak
KEYCLOAK_REALM=canton
KEYCLOAK_URL=https://auth.canquestlabs.com
LEDGER_CLIENT_ID=validator-app-backend
LEDGER_CLIENT_SECRET=<secret valid dari Keycloak admin>
LEDGER_API_AUTH_SCOPE=daml_ledger_api
LEDGER_API_ADMIN_USER=fc334391-0f6a-456f-bb95-098b269e62b6  (UUID)
```

**Token endpoint:** `https://auth.canquestlabs.com/realms/canton/protocol/openid-connect/token`

### Party IDs (production, dari VPS 2 .env)

```
CANTON_OPERATOR_PARTY_ID      = canquest-operator::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
CANTON_VALIDATOR_PARTY_ID     = canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
CANTON_DSO_PARTY_ID           = DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc
CANTON_APP_PROVIDER_PARTY_ID  = app-canquest::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
LEDGER_API_ADMIN_USER         = fc334391-0f6a-456f-bb95-098b269e62b6
```

Untuk 7TRUST, party yang relevan kemungkinan **app-canquest** (app provider) atau
**canquest-validator-1** (validator). Confirm di first login nanti.

---

## 3. STEP 1 — DEPLOY DAR (7TRUST)

### 3a. Download DAR 7TRUST

DAR download dari public GitHub C7. **TODO di chat baru: cari link DAR yang benar.**

Berdasarkan guide: "Download the latest DAR file here from the public C7 GitHub repository".
Likely repo: `github.com/c7-digital/*`. Cari:
- release asset `.dar` file
- atau `packages/daml/.daml/dist/*.dar`

```bash
# Di VPS 1 (atau lokal lalu scp):
wget -O 7trust.dar "<DAR_DOWNLOAD_URL>"   # ← isi URL dari GitHub C7
```

### 3b. Upload DAR ke participant node

**Pola upload SUDAH TER-VERIFIED jalan** di repo Anda (untuk canquest-v23).
Pattern (dari `packages/daml/README.md` + `apps/api/scripts/upload-daml-dar.cjs`):

```bash
# 1. Dapat token dari Keycloak
TOKEN=$(curl -s -X POST "https://auth.canquestlabs.com/realms/canton/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$LEDGER_CLIENT_ID" \
  --data-urlencode "client_secret=$LEDGER_CLIENT_SECRET" \
  --data-urlencode "scope=daml_ledger_api" | jq -r .access_token)

# 2. Upload DAR (raw bytes, Content-Type octet-stream)
curl -X POST "https://ledger.canquestlabs.com/v2/packages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @7trust.dar

# 3. Verify package count (harus +1)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://ledger.canquestlabs.com/v2/packages" | jq '.packageIds | length'
#   Sebelumnya 125 packages → setelah 7TRUST upload = 126

# 4. List packages, cari yang 7trust
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://ledger.canquestlabs.com/v2/packages" | jq -r '.packageDetails[] | select(.packageName | test("7trust|seventrust|c7"; "i")) | .packageName + " " + .packageVersion'
```

⚠️ **Catatan soal vetting:** Upload DAR ke `/v2/packages` **tidak butuh vetting**.
Tapi **menggunakan** DAR (create contract / exercise choice) butuh vetting party.
Bila 7TRUST client gagal pertama kali dengan error "package not vetted", perlu
vetting via participant admin API (TODO: confirm command di chat baru).

---

## 4. STEP 2 — DEPLOY DOCKER CLIENT (7TRUST)

### 4a. Pull Docker image

```bash
# Di VPS 1:
# TESTNET (utk test dulu):
docker pull ghcr.io/c7-digital/7trust-client:test

# MAINNET (production):
docker pull ghcr.io/c7-digital/7trust-client:prod
```

### 4b. Env variables 7TRUST (4 required + 1 optional)

| Var 7TRUST | Value untuk setup Anda |
|---|---|
| `CANTON_LEDGER_URL` | `https://ledger.canquestlabs.com` (atau `http://172.18.0.5:7575` internal) |
| `OIDC_AUTHORITY` | `https://auth.canquestlabs.com/realms/canton` (Keycloak issuer) |
| `OIDC_CLIENT_ID` | **TODO: buat client baru di Keycloak** (lihat 4c) |
| `AUTH0_AUTH_AUDIENCE` | (optional, skip — bukan Auth0) |

⚠️ **7TRUST client listen port 8080** — tapi Keycloak Anda juga pakai 8080 di Docker.
**Konflik port!** Solusi:
- 7TRUST di port beda, mis. 8088 (map `-p 8088:8080`)
- atau beda host / subdomain via nginx

### 4c. Buat OIDC client baru di Keycloak (TODO)

7TRUST butuh OIDC_CLIENT_ID. Anda belum punya client OIDC untuk web (web Anda
pakai login email+password lokal, bukan Keycloak). Minta assistant chat baru
untuk buat client baru:

```
Buat Keycloak client baru utk 7TRUST di realm canton:
- Client ID: 7trust-client (atau sesuai naming)
- Client protocol: openid-connect
- Access type: confidential (atau public kalau SPA-only)
- Redirect URIs: https://7trust.canquestlabs.com/*  (atau URL 7TRUST client)
- Web origins: https://7trust.canquestlabs.com
```

Dapatkan client ID + secret dari Keycloak admin console
(`https://auth.canquestlabs.com/admin/canton/`).

### 4d. Run Docker container

```bash
docker run -d \
  --name 7trust-client \
  --restart unless-stopped \
  -p 8088:8080 \
  -e CANTON_LEDGER_URL=https://ledger.canquestlabs.com \
  -e OIDC_AUTHORITY=https://auth.canquestlabs.com/realms/canton \
  -e OIDC_CLIENT_ID=7trust-client \
  ghcr.io/c7-digital/7trust-client:prod

# Cek logs:
docker logs -f 7trust-client
```

### 4e. (Recommended) Setup subdomain + nginx reverse proxy

Biar bisa akses via browser dengan HTTPS, buat subdomain baru:

```bash
# DNS (di Cloudflare):
#   7trust.canquestlabs.com → A 162.250.191.195  (VPS 1)

# Host nginx di VPS 1 (/etc/nginx/sites-available/7trust.canquestlabs.com):
server {
    listen 443 ssl http2;
    server_name 7trust.canquestlabs.com;

    # SSL via Cloudflare (origin cert) atau certbot
    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

sudo ln -sf /etc/nginx/sites-available/7trust.canquestlabs.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. STEP 3 — FIRST LOGIN + DNS VERIFICATION

1. Buka `https://7trust.canquestlabs.com` di browser
2. Login pakai credentials Keycloak (company IAM/SSO atau token)
3. Accept Terms & Conditions + Privacy Policy
4. App guide DNS domain verification:
   - 7TRUST minta Anda add DNS record (TXT/CNAME) yang proves domain ownership
   - Domain yang di-verify = `canquestlabs.com` (linked ke Canton Party ID Anda)
5. Follow on-screen → terbit 7TRUST credential on-chain

---

## 6. PERTANYAAN YANG PERLU DI-CLARIFY DI CHAT BARU

Sebelum eksekusi, assistant chat baru harus bantu jawab:

1. **DAR 7TRUST source** — link GitHub C7 yang benar (release asset .dar).
   Saat ini belum konfirm.
2. **OIDC client** — buat baru atau reuse `validator-app-backend`?
   Rekomendasi: buat baru (`7trust-client`) supaya isolasi.
3. **Port conflict** — Keycloak & 7TRUST sama-sama 8080. Solusi: 7TRUST ke 8088.
4. **Vetting** — apakah DAR 7TRUST butuh vetting participant sebelum dipakai?
   Bila ya, perlu admin API call ke participant node.
5. **Mainnet vs Testnet** — mulai dengan testnet (`:test`) dulu, baru prod (`:prod`)?
   Rekomendasi: test dulu.
6. **Party ID mana yang dipakai 7TRUST** — app-canquest? validator? Confirm saat first login.

---

## 7. KEY FILES UNTUK REFERENSI

| File | Isi |
|---|---|
| `REALTIME_WS_HANDOFF.md` | VPS1 infra lengkap (docker layout, domains, ports) |
| `HANDOFF_DAML_V23.md` | Party IDs, package version, infra |
| `packages/daml/README.md` | Pola curl upload DAR + token recipe |
| `apps/api/scripts/upload-daml-dar.cjs` | Uploader script (canonical, bisa dipakai utk 7TRUST) |
| `infra/env/api.env.production.example` | Canton env (LEDGER_API_URL, secrets) |
| `docs/MIGRATION_KEYCLOAK_PUBLIC_API.md` | Keycloak client config reference |
| `docs/NETWORK_TOPOLOGY.md` | WireGuard / network topology VPS1↔VPS2 |

---

## 8. CHECKLIST (centang saat selesai di chat baru)

```
[ ] 1. Dapat link download DAR 7TRUST dari GitHub C7
[ ] 2. Download DAR 7TRUST
[ ] 3. Upload DAR ke participant (POST /v2/packages) → verify package count +1
[ ] 4. (bila perlu) Vetting DAR 7TRUST di participant
[ ] 5. Buat OIDC client 7trust-client di Keycloak realm canton
[ ] 6. Pull Docker image 7trust-client (test dulu, lalu prod)
[ ] 7. Run container dgn env (CANTON_LEDGER_URL, OIDC_AUTHORITY, OIDC_CLIENT_ID)
[ ] 8. Setup subdomain 7trust.canquestlabs.com (DNS + nginx)
[ ] 9. First login via browser
[ ] 10. Accept T&C
[ ] 11. DNS verification domain canquestlabs.com
[ ] 12. 7TRUST credential terbit on-chain
```
