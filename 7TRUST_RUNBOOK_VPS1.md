# 7TRUST Domain Verification — Runbook Eksekusi Manual di VPS 1

> **STATUS: DEPLOYED 2026-08-05** ✅ — 11/12 langkah selesai, infrastruktur jalan
> production. Tinggal first login + DNS verify (browser-only).
>
> **Cara pakai:** Buka terminal SSH ke VPS 1 (`ssh root@162.250.191.195`),
> lalu copy-paste tiap block command sesuai urutan.
>
> **Target host:** VPS 1 (hostname: `ubuntu`, IP 162.250.191.195) — Canton participant node
> **Sumber guide resmi:** 7TRUST Deployment Guide (PDF dari 7trust.c7.digital)
> **DAR:** `domain-verification-model-0.1.0.dar` dari `github.com/C7-Digital/public-dars`
> **Docker:** `ghcr.io/c7-digital/7trust-client:prod` (mainnet, langsung — bukan testnet)
> **Tanggal:** 2026-08-05
>
> **LESSON LEARNED (penting, dari eksekusi 2026-08-05):**
> - Container listen **port 8080** (bukan 80 per guide). Mapping host: `-p 8088:8080`.
> - **JANGAN tambah `listen 80` block** di nginx — akan konflik dgn docker-proxy
>   splice-validator-nginx (`127.0.0.1:80`) dan bikin nginx restart GAGAL = production down.
>   Hanya `listen 443` block. Cloudflare sudah handle HTTPS terminate.
> - Image `:prod` **hardcoded mainnet** (`C7_API_BACKEND_URL`, `C7_ISSUER_PARTY`, `CANTON_NETWORK=prod`).
>   Hanya override `CANTON_LEDGER_URL`, `OIDC_AUTHORITY`, `OIDC_CLIENT_ID`.
> - `systemctl restart nginx` bisa GAGAL bila ada zombie/port conflict. Pakai
>   `systemctl reload` setelah edit config. Hanya `restart` bila yakin tidak ada konflik.

---

## ⚠️ CATATAN PRODUCTION SAFETY

VPS 1 sedang production (Canton participant + Keycloak + validator). Runbook ini
**read-only terhadap service existing** kecuali langkah yang jelas menambah
(DAR upload = append-only, docker run = container baru di port 8088, nginx
subdomain baru = config terpisah). **Tidak ada perubahan pada**:
- Canton participant container yang jalan
- Keycloak container / realm `canton` existing (kita TAMBAH client baru, bukan edit)
- nginx `ledger.canquestlabs.com` / `auth.canquestlabs.com` existing
- Service di VPS 2

---

## PERSIAPAN — cek baseline dulu (read-only, aman)

```bash
# 0a. Konfirmasi host & user
hostname && whoami && uname -a

# 0b. Konfirmasi docker layout existing (HARUS muncul canton-participant + keycloak)
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" | head -20

# 0c. Cek IP internal participant (guide bilang JSON API di port 7575)
docker inspect canton-participant --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null
#   Expected: 172.18.0.x (mis. 172.18.0.5)

# 0d. Cek port 8088 masih kosong (akan dipakai 7TRUST)
ss -tlnp | grep -E ':8088' || echo "PORT 8088 FREE — OK"
#   Kalau ada output = port dipakai, cari port lain (mis. 8089) & update semua command

# 0e. Load credential Keycloak dari .env VPS2 (yang sama dipakai backend Anda)
#   Bila .env VPS2 tidak accessible dari sini, ambil value manual & export di sini:
#     LEDGER_CLIENT_ID=<dari apps/api/.env VPS2>
#     LEDGER_CLIENT_SECRET=<dari apps/api/.env VPS2>
#   Atau kalau ada akses ke file:
# LEDGER_CLIENT_ID=$(grep -E '^LEDGER_CLIENT_ID=' /path/ke/apps/api/.env | head -1 | cut -d= -f2- | tr -d '"'"'"'')
# LEDGER_CLIENT_SECRET=$(grep -E '^LEDGER_CLIENT_SECRET=' /path/ke/apps/api/.env | head -1 | cut -d= -f2- | tr -d '"'"'"'')

echo "CLIENT_ID=$LEDGER_CLIENT_ID"
echo "SECRET_SET=$([ -n "$LEDGER_CLIENT_SECRET" ] && echo yes || echo no)"
```

**✅ Exit criteria langkah 0:** docker ps menunjukkan canton-participant + keycloak jalan, port 8088 bebas, `LEDGER_CLIENT_ID`/`SECRET` terisi.

---

## LANGKAH 1 — Download DAR 7TRUST

```bash
cd ~  # atau direktori kerja pilihan
mkdir -p 7trust-deploy && cd 7trust-deploy

# DAR dari public C7 GitHub (ter-verify 302→200, 554506 bytes, octet-stream)
curl -L -o domain-verification-model-0.1.0.dar \
  "https://github.com/C7-Digital/public-dars/releases/download/domain-verification/v0.1.0/domain-verification-model-0.1.0.dar"

# ✅ Verify size (HARUS 554506)
ls -l domain-verification-model-0.1.0.dar
EXPECTED=554506
ACTUAL=$(stat -c %s domain-verification-model-0.1.0.dar)
[ "$ACTUAL" = "$EXPECTED" ] && echo "✅ SIZE OK ($ACTUAL)" || echo "❌ SIZE MISMATCH (expected $EXPECTED, got $ACTUAL)"

# Verify ini DAR/zip (DAR = zip archive)
file domain-verification-model-0.1.0.dar
# Expected: Zip archive data
unzip -l domain-verification-model-0.1.0.dar | head -10
```

**✅ Exit criteria:** size 554506, `file` bilang Zip archive, `unzip -l` menampilkan isi DAR (META-INF, daml/*.dalf, dll).

---

## LANGKAH 2 — Get token Keycloak + baseline package count

```bash
# Token recipe (sama persis dgn scripts/check-parties.sh — ter-verify)
TOKEN_URL="https://auth.canquestlabs.com/realms/canton/protocol/openid-connect/token"

TOKEN=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$LEDGER_CLIENT_ID" \
  --data-urlencode "client_secret=$LEDGER_CLIENT_SECRET" \
  --data-urlencode "scope=daml_ledger_api" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null)

[ -z "$TOKEN" ] && { echo "❌ TOKEN KOSONG — cek LEDGER_CLIENT_ID/SECRET"; exit 1; }
echo "✅ Token acquired (${#TOKEN} chars)"

# Simpan token ke file supaya tidak re-fetch tiap command
echo "$TOKEN" > /tmp/7trust.token

# ✅ Baseline package count (CATAT ANGKA INI)
BEFORE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://ledger.canquestlabs.com/v2/packages" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('packageIds',[])))")
echo "📦 Package count SEBELUM upload: $BEFORE"
echo "$BEFORE" > /tmp/7trust.before
```

**✅ Exit criteria:** token ter-acquire (panjang >100 chars), angka package count tercatat di `/tmp/7trust.before`.

---

## LANGKAH 3 — Upload DAR ke participant node

```bash
TOKEN=$(cat /tmp/7trust.token)

# Upload (raw bytes, octet-stream — pola ter-verify dari scripts/check-parties.sh)
echo "⬆️  Uploading DAR..."
HTTP_CODE=$(curl -s -o /tmp/7trust.upload.response -w "%{http_code}" \
  -X POST "https://ledger.canquestlabs.com/v2/packages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @domain-verification-model-0.1.0.dar)

echo "HTTP status: $HTTP_CODE"
echo "Response body:"
cat /tmp/7trust.upload.response
echo ""

# ✅ Verify package count +1 (atau +N bila DAR dependensi)
AFTER=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://ledger.canquestlabs.com/v2/packages" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('packageIds',[])))")
BEFORE=$(cat /tmp/7trust.before)
echo "📦 Package count SESUDAH upload: $AFTER"
echo "Delta: $((AFTER - BEFORE))"
[ "$AFTER" -gt "$BEFORE" ] && echo "✅ PACKAGE COUNT NAIK (+$((AFTER-BEFORE)))" || echo "❌ TIDAK NAIK — cek response body"

# ✅ Cari DAR domain-verification di list
echo ""
echo "🔍 Mencari DAR domain-verification / 7trust di ledger:"
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://ledger.canquestlabs.com/v2/packages" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
import re
for p in d.get('packageDetails',[]):
    name=p.get('packageName','')
    if re.search(r'7trust|seventrust|domain.?verif|credential|c7', name, re.I):
        print(f\"  ✅ {name} v{p.get('packageVersion','?')} -> {p.get('packageId','?')}\")"

# Ambil package ID 7TRUST (untuk vetting check nanti bila perlu)
PKG_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://ledger.canquestlabs.com/v2/packages" \
  | python3 -c "
import sys,json,re
d=json.load(sys.stdin)
for p in d.get('packageDetails',[]):
    if re.search(r'domain.?verif|7trust', p.get('packageName',''), re.I):
        print(p.get('packageId','')); break")
echo "7TRUST package ID: $PKG_ID"
[ -n "$PKG_ID" ] && echo "$PKG_ID" > /tmp/7trust.pkgid
```

**✅ Exit criteria:** HTTP 200 (atau 200 dengan response body), package count naik, DAR `domain-verification` muncul di list.

**Bila HTTP non-200:**
- `401/403` → token invalid/scope salah. Re-fetch token, pastikan `scope=daml_ledger_api`.
- `409` atau "already exists" → DAR sudah pernah di-upload. OK, lanjut ke langkah 4. Cek package list untuk confirm.
- `413` → payload too large (tidak mungkin, DAR cuma 554KB).

---

## LANGKAH 4 — (Opsional) Cek vetting DAR

> Upload tidak butuh vetting, tapi **menggunakan** DAR mungkin butuh. Cek dulu
> apakah DAR sudah auto-vetted untuk participant Anda.

```bash
TOKEN=$(cat /tmp/7trust.token)
PKG_ID=$(cat /tmp/7trust.pkgid 2>/dev/null)

# Cek vetting status (participant admin API — lihat DAML/Canton docs)
# Format: GET /v2/parties dari participant admin, atau cek via specific vetting endpoint
echo "🔍 Cek vetting DAR 7TRUST (package: $PKG_ID)..."
echo "(Bila client gagal 'package not vetted' di langkah 8, jalankan vetting command di §LANGKAH 4b)"

# Catat party-participant yang relevan
echo ""
echo "🔍 Party-participant mapping:"
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://ledger.canquestlabs.com/v2/parties" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for p in d.get('results',[])[:10]:
    print(f\"  {p.get('party','?')[:60]}... -> {p.get('displayName','?')}\")" 2>/dev/null || echo "(endpoint/parse issue)"
```

### LANGKAH 4b — (Bila perlu) Vetting DAR

Hanya jalankan bila client error "package not vetted" di langkah 8. Command
vetting via participant admin (konfirm syntax exact di log error):

```bash
# Placeholder — confirm command dari error message participant:
# Canton vetting admin endpoint biasanya:
#   POST /api/parties/vetting request via participant gRPC admin (port 5001)
# atau via JSON admin API bila tersedia.
# TODO: isi bila muncul error "not vetted"
```

---

## LANGKAH 5 — Pull Docker image 7TRUST client

```bash
# Mulai dgn TESTNET (:test = 417). Setelah verify OK, switch ke :prod.
docker pull ghcr.io/c7-digital/7trust-client:test

# ✅ Verify image ada lokal
docker images ghcr.io/c7-digital/7trust-client
# Expected: baris dgn tag test, size beberapa ratus MB

# (Optional) Inspect env default image
docker inspect ghcr.io/c7-digital/7trust-client:test \
  --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | head -10
docker inspect ghcr.io/c7-digital/7trust-client:test \
  --format '{{range .Config.ExposedPorts}}{{.}}{{end}}' 2>/dev/null
```

**✅ Exit criteria:** image ter-pull, `docker images` menampilkan `ghcr.io/c7-digital/7trust-client` tag `test`.

---

## LANGKAH 6 — Buat OIDC client baru di Keycloak (MANUAL via admin console)

> 7TRUST butuh OIDC client untuk **user login browser** (company IAM/SSO).
> `validator-app-backend` pakai client_credentials (machine-to-machine), **tidak cocok**.
> Guide beri contoh client_id = `domain-verification`.

**Buka browser → Keycloak admin:**
```
https://auth.canquestlabs.com/admin/canton/
```
Login pakai admin credential Keycloak Anda.

**Buat client baru:**
1. Sidebar kiri → **Clients** → tombol **Create client**
2. **Client type:** `OpenID Connect`
3. **Client ID:** `domain-verification` ← persis contoh guide
4. **Name:** `7TRUST Domain Verification`
5. Next → **Client authentication:** ON (confidential) — supaya ada secret
6. **Authentication flow:** centang:
   - ✅ Standard flow (browser login)
   - ✅ Direct access grants (opsional, utk testing)
7. Next → **Valid redirect URIs:**
   ```
   https://7trust.canquestlabs.com/*
   http://localhost:8088/*    (utk testing lokal di VPS1)
   http://162.250.191.195:8088/*  (utk testing via IP langsung)
   ```
8. **Web origins:**
   ```
   https://7trust.canquestlabs.com
   ```
9. **Save**

**Ambil secret:**
1. Buka client `domain-verification` → tab **Credentials**
2. Copy **Client secret** → simpan (akan dipakai di env container)

**✅ Exit criteria:** client `domain-verification` ada di list, punya secret, redirect URIs ter-set.

> Catat: `OIDC_CLIENT_ID=domain-verification`, `OIDC_CLIENT_SECRET=<secret barusan>`.

---

## LANGKAH 7 — Run 7TRUST container

```bash
# Set env (isi dari langkah 6)
export OIDC_CLIENT_ID=domain-verification
export OIDC_CLIENT_SECRET="<PASTE_SECRET_DARI_KEYCLOAK>"

# Stop & hapus container lama bila ada
docker rm -f 7trust-client 2>/dev/null

# Run — port 8088 di host (8080 di container), bukan 8080 host (dipakai Keycloak!)
docker run -d \
  --name 7trust-client \
  --restart unless-stopped \
  -p 8088:8080 \
  -e CANTON_LEDGER_URL=https://ledger.canquestlabs.com \
  -e OIDC_AUTHORITY=https://auth.canquestlabs.com/realms/canton \
  -e OIDC_CLIENT_ID=$OIDC_CLIENT_ID \
  ghcr.io/c7-digital/7trust-client:test

# ✅ Cek container jalan
sleep 3
docker ps --filter name=7trust-client --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# ✅ Cek logs (harus start tanpa crash)
docker logs --tail 30 7trust-client

# ✅ Test HTTP dari VPS1 sendiri
curl -sI http://127.0.0.1:8088 | head -5
# Expected: HTTP/1.1 200 atau 302/301 (redirect ke OIDC login)
```

**✅ Exit criteria:** container `Up`, logs tidak ada error fatal, curl balas 200/302.

**Troubleshooting logs:**
- `OIDC discovery failed` → cek `OIDC_AUTHORITY` reachable: `curl https://auth.canquestlabs.com/realms/canton/.well-known/openid-configuration`
- `Canton connection refused` → cek `CANTON_LEDGER_URL`: `curl https://ledger.canquestlabs.com/v2/packages` (harus 401 tanpa token, bukan connection error)
- `address already in use` → port 8088 dipakai. Stop konflik atau ganti `-p 8089:8080`.

---

## LANGKAH 8 — Setup subdomain + nginx reverse proxy

### 8a. DNS (di Cloudflare dashboard)

Tambah A record:
```
Type: A
Name: 7trust
Content: 162.250.191.195
Proxy: Proxied (orange cloud) — konsisten dgn subdomain lain
TTL: Auto
```

**✅ Verify** (setelah 1-2 menit): `dig +short 7trust.canquestlabs.com` harus balas IP Cloudflare.

### 8b. Nginx config di VPS 1

```bash
# Buat server block baru (TERPISAH dari ledger/auth — jangan edit yang existing)
cat > /tmp/7trust.canquestlabs.com <<'EOF'
server {
    listen 443 ssl http2;
    server_name 7trust.canquestlabs.com;

    # SSL: pakai Cloudflare Origin Cert (sama dgn ledger/auth)
    # Cek path cert existing:
    #   grep ssl_certificate /etc/nginx/sites-available/ledger.canquestlabs.com
    ssl_certificate     /etc/ssl/cf-origin/cert.pem;
    ssl_certificate_key /etc/ssl/cf-origin/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WS support (7TRUST mungkin pakai WS utk on-chain updates)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 86400s;
    }
}
EOF

# ⚠️ PERTAMA: cek path cert SSL yang existing dipakai ledger/auth
echo "=== SSL cert path existing ==="
grep -E "ssl_certificate" /etc/nginx/sites-available/ledger.canquestlabs.com 2>/dev/null
grep -E "ssl_certificate" /etc/nginx/sites-available/auth.canquestlabs.com 2>/dev/null
# Bila path BERBEDA dari /etc/ssl/cf-origin/, edit file /tmp di atas dulu.

# Cek map $connection_upgrade ada di nginx.conf (harusnya sudah, dari handoff WS)
grep -A2 "map.*connection_upgrade" /etc/nginx/nginx.conf

# Install config
sudo cp /tmp/7trust.canquestlabs.com /etc/nginx/sites-available/7trust.canquestlabs.com
sudo ln -sf /etc/nginx/sites-available/7trust.canquestlabs.com /etc/nginx/sites-enabled/

# ✅ Test config (HARUS pass sebelum reload)
sudo nginx -t

# Reload
sudo systemctl reload nginx
echo "✅ nginx reloaded"
```

**✅ Exit criteria:** `nginx -t` pass, `systemctl reload` OK, `curl -kI https://7trust.canquestlabs.com` balas 200/302/502.

> Bila `502 Bad Gateway` → container tidak jalan atau port salah. Cek `docker ps`.
> Bila `525/526 SSL` dari Cloudflare → cert origin tidak match, cek Cloudflare SSL mode = "Full (strict)" dengan origin cert ter-install.

---

## LANGKAH 9 — First login via browser

```
https://7trust.canquestlabs.com
```

1. **Login screen** muncul → klik login → redirect ke Keycloak `auth.canquestlabs.com`
2. Login pakai credential Keycloak user Anda (company IAM/SSO)
   - Bila belum ada user test di realm `canton`, buat di Keycloak admin → **Users** → add user → set password → assign role bila perlu
3. Setelah login, redirect balik ke 7TRUST client
4. **Accept Terms & Conditions + Privacy Policy** → centang → Accept
5. App guide **DNS domain verification**:
   - 7TRUST minta Anda add DNS record (TXT/CNAME) yang proves ownership `canquestlabs.com`
   - Pilih party ID Anda saat prompted — kandidat: `canquest-validator-1` (7Trust target = validator)
6. Tambah DNS record di Cloudflare, tunggu 7TRUST verify
7. **7TRUST credential terbit on-chain** ✅

**✅ Exit criteria:** credential 7TRUST muncul, link ke Canton Party ID verified.

---

## LANGKAH 10 — (Setelah test OK) Switch :test → :prod

```bash
docker rm -f 7trust-client

docker pull ghcr.io/c7-digital/7trust-client:prod

export OIDC_CLIENT_ID=domain-verification
export OIDC_CLIENT_SECRET="<secret dari langkah 6>"

docker run -d \
  --name 7trust-client \
  --restart unless-stopped \
  -p 8088:8080 \
  -e CANTON_LEDGER_URL=https://ledger.canquestlabs.com \
  -e OIDC_AUTHORITY=https://auth.canquestlabs.com/realms/canton \
  -e OIDC_CLIENT_ID=$OIDC_CLIENT_ID \
  ghcr.io/c7-digital/7trust-client:prod

sleep 3
docker ps --filter name=7trust-client
docker logs --tail 20 7trust-client

# Re-test first login di https://7trust.canquestlabs.com
```

---

## ROLLBACK (kalau ada masalah production)

```bash
# Stop & hapus container 7TRUST (tidak sentuh service lain)
docker rm -f 7trust-client

# Disable nginx subdomain (tidak hapus config, cuma disable)
sudo rm -f /etc/nginx/sites-enabled/7trust.canquestlabs.com
sudo nginx -t && sudo systemctl reload nginx

# DAR yang sudah di-upload TIDAK BISA di-remove via API (Canton immutable packages).
#   Tapi DAR yang tidak dipakai = inert (tidak ada contract pakai template-nya).
#   Aman, tidak perlu rollback DAR.

# OIDC client Keycloak bisa di-disable/delete via admin console bila mau.

# DNS record di Cloudflare bisa dihapus bila tidak dipakai.
```

---

## CHECKLIST EKSEKUSI

```
[x] 0.  Baseline: docker layout OK, port 8088 free, credential ter-set
[x] 1.  Download DAR (size 554506, Zip archive) — domain-verification-model-0.1.0.dar
[x] 2.  Token Keycloak + baseline package count (125) tercatat
[x] 3.  Upload DAR → package count 126, package ID be0b32ad... confirmed
[x] 4.  Cek vetting — package ada di ledger (vetting bila perlu saat first login)
[x] 5.  Docker pull ghcr.io/c7-digital/7trust-client:prod (mainnet langsung)
[x] 6.  OIDC client domain-verification dibuat di Keycloak (public, standardFlow)
[x] 7.  Container run port 8088:8080, nginx up, logs bersih
[x] 8.  Subdomain 7trust.canquestlabs.com (DNS CF + nginx 443 only), HTTP 200
[x] 9a. User 7trust-admin dibuat + grant rights actAs party canquest-validator-1
[ ] 9b. First login via browser (https://7trust.canquestlabs.com) + T&C + DNS verify
[ ] 9c. 7TRUST credential terbit on-chain
```

## STATE FINAL (deployed 2026-08-05)

| Item | Value |
|---|---|
| DAR package ID | `be0b32ad325c3b3573d0a16cae3d3221c2e5c860869eb2bfb399e89f6519d7db` |
| Container | `7trust-client` (image `:prod`), port `0.0.0.0:8088->8080/tcp` |
| Subdomain | `https://7trust.canquestlabs.com` → Cloudflare → nginx 443 → `127.0.0.1:8088` |
| OIDC client | `domain-verification` (public, standardFlow, realm `canton`) |
| Login user | `7trust-admin` (UUID `7247e6cf-e004-4162-ad8b-81706e657301`) |
| Party verified | `canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb` |
| nginx config | `/etc/nginx/sites-available/7trust.canquestlabs.com` (443 only, no listen 80) |
| C7 API (mainnet) | `https://c7trust-api.canton.global.canton.network.c7.digital` (hardcoded di image) |
| C7 issuer party | `c7trust::12202e2325b04b0f0ee30685088289293b3e7a28d8b26470b39435502912e2876cba` |

## COMMANDS VERIFIED (copy-paste siap pakai)

### Recreate container (kalau perlu restart)
```bash
docker rm -f 7trust-client
docker run -d \
  --name 7trust-client \
  --restart unless-stopped \
  -p 8088:8080 \
  -e CANTON_LEDGER_URL=https://ledger.canquestlabs.com \
  -e OIDC_AUTHORITY=https://auth.canquestlabs.com/realms/canton \
  -e OIDC_CLIENT_ID=domain-verification \
  ghcr.io/c7-digital/7trust-client:prod
```

### Verify semuanya jalan
```bash
# Container
docker ps --filter name=7trust-client
# HTTP local
curl -sI http://127.0.0.1:8088/ | head -3
# HTTP via domain
curl -sI https://7trust.canquestlabs.com/ | head -5
# nginx
systemctl is-active nginx
```

### Rollback (emergency, TIDAK sentuh production lain)
```bash
docker rm -f 7trust-client
rm -f /etc/nginx/sites-enabled/7trust.canquestlabs.com
nginx -t && systemctl reload nginx
# DAR immutable (tidak bisa remove), tapi inert bila tidak ada contract pakai.
# User 7trust-admin: disable via Keycloak admin bila perlu.
```

---

## REFERENSI CEPAT

| Item | Value |
|---|---|
| DAR URL | `github.com/C7-Digital/public-dars/releases/download/domain-verification/v0.1.0/domain-verification-model-0.1.0.dar` |
| DAR size | 554506 bytes |
| Docker image | `ghcr.io/c7-digital/7trust-client` (`:test`=417, `:prod`=418=latest) |
| Host port | 8088 (container 8080; host 8080 = Keycloak, jangan conflict) |
| OIDC authority | `https://auth.canquestlabs.com/realms/canton` |
| OIDC client_id | `domain-verification` (per guide) |
| Canton ledger URL | `https://ledger.canquestlabs.com` |
| Token endpoint | `https://auth.canquestlabs.com/realms/canton/protocol/openid-connect/token` |
| Upload endpoint | `POST https://ledger.canquestlabs.com/v2/packages` |
| Subdomain | `7trust.canquestlabs.com` → A 162.250.191.195 |
| Guide resmi | 7TRUST Deployment Guide (PDF, dari 7trust.c7.digital setelah register) |
