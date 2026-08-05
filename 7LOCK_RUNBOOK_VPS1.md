# 7LOCK Marketplace — Runbook Eksekusi Manual di VPS 1

> **STATUS: DEPLOYED 2026-08-05** ✅ — Infrastruktur jalan production.
> Registration (role selection) butuh 7TRUST credential terbit dulu.
>
> **Cara pakai:** Buka terminal SSH ke VPS 1 (`ssh root@162.250.191.195`).
>
> **Target host:** VPS 1 (hostname: `ubuntu`, IP 162.250.191.195) — Canton participant node
> **Sumber guide resmi:** 7LOCK Client Deployment Guide (PDF dari 7lock.cc)
> **DAR:** `c7lock-model-0.2.6.dar` dari `github.com/C7-Digital/public-dars`
> **Docker:** `ghcr.io/c7-digital/c7lock-client:prod` (mainnet, langsung)
> **Tanggal:** 2026-08-05
>
> **PREREQ:** 7TRUST credential harus terbit dulu (DNS verify di 7TRUST client)
> sebelum registration di 7LOCK bisa selesai (link 7TRUST-verified domain).

## STATE FINAL (deployed 2026-08-05)

| Item | Value |
|---|---|
| DAR package ID | `d184b0687744f828647df10ef0a9f516af01df49d38c4434f84d00a54b867d4a` |
| Container | `c7lock-client` (image `:prod`), port `0.0.0.0:8089->8080/tcp` |
| Network | `splice-validator_splice_validator` (internal docker, langsung ke participant) |
| Subdomain | `https://7lock.canquestlabs.com` → Cloudflare → nginx 443 → `127.0.0.1:8089` |
| OIDC client | `c7lock-client` (public, standardFlow, realm `canton`) |
| Login user | `7trust-admin` (REUSE dari 7TRUST — sudah actAs validator) |
| nginx config | `/etc/nginx/sites-available/7lock.canquestlabs.com` (443 only, no listen 80) |
| C7 API (mainnet) | `https://c7lock-api.canton.global.canton.network.c7.digital` (hardcoded) |
| C7 lock party | `c7lock::12202e2325b04b0f0ee30685088289293b3e7a28d8b26470b39435502912e2876cba` |
| SCAN_BASE_URL | `https://scan.sv-1.dev.global.canton.network.sync.global/api/scan` (DEV default — butuh mainnet utk Lock Provider) |

## COMMANDS (pola sama 7TRUST, lessons applied)

### Upload DAR (via internal participant — bypass nginx host limit!)
```bash
# c7lock DAR >1MB → nginx host tolak 413. Upload via 172.18.0.6:7575 langsung.
cd ~/7trust-deploy
TOKEN=$(curl -s -X POST "https://auth.canquestlabs.com/realms/canton/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=validator-app-backend" \
  --data-urlencode "client_secret=SulGMSw5bFpDl1KWlLWt0Xm2eBnao1yF" \
  --data-urlencode "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

curl -X POST "http://172.18.0.6:7575/v2/packages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @c7lock-model-0.2.6.dar
```

### Recreate container
```bash
docker rm -f c7lock-client
docker run -d \
  --name c7lock-client \
  --restart unless-stopped \
  --network splice-validator_splice_validator \
  -p 8089:8080 \
  -e CANTON_LEDGER_URL=http://172.18.0.6:7575 \
  -e OIDC_AUTHORITY=https://auth.canquestlabs.com/realms/canton \
  -e OIDC_CLIENT_ID=c7lock-client \
  ghcr.io/c7-digital/c7lock-client:prod
```

### nginx config (443 ONLY — JANGAN listen 80)
```nginx
server {
    listen 443 ssl http2;
    server_name 7lock.canquestlabs.com;
    ssl_certificate     /etc/ssl/canquestlabs/certificate.pem;
    ssl_certificate_key /etc/ssl/canquestlabs/private.key;
    location / {
        proxy_pass http://127.0.0.1:8089;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 86400s;
    }
}
```

### Verify
```bash
docker ps --filter name=c7lock-client
curl -sI http://127.0.0.1:8089/ | head -3
curl -sI https://7lock.canquestlabs.com/ | head -5
```

## CHECKLIST

```
[x] 1. Download DAR c7lock-model-0.2.6 (1092725 bytes)
[x] 2. Upload DAR via internal 172.18.0.6:7575 (bypass nginx 413) → count 127
[x] 3. Docker pull c7lock-client:prod (mainnet, hardcoded env)
[x] 4. Buat OIDC client c7lock-client di Keycloak (public, standardFlow)
[x] 5. Run container port 8089:8080 (network splice internal)
[x] 6. Subdomain 7lock.canquestlabs.com (DNS CF + nginx 443 only)
[ ] 7. First login via browser (user 7trust-admin) + T&C
[ ] 8. Role selection (Lock Seeker / Lock Provider) + registration
     ↑ BUTUH 7TRUST credential terbit dulu
```

## LESSON LEARNED 7LOCK (delta dari 7TRUST)

1. **DAR >1MB → nginx host 413.** Bypass via internal participant `172.18.0.6:7575`
   (tidak kena limit nginx host). Tidak perlu edit `client_max_body_size`.
2. **Reuse user `7trust-admin`** — tidak perlu buat user baru (sudah actAs validator,
   sudah register di ledger API id=`7trust-admin`).
3. **Port 8089** (8088 dipakai 7TRUST).
4. **nginx 443 only** (lesson dari 7TRUST insiden — jangan listen 80).
5. **Issuer HTTPS** sudah fix global (dari 7TRUST) — c7lock langsung jalan.
6. **SCAN_BASE_URL default masih DEV** — utk Lock Provider role, perlu set ke
   mainnet scan (TODO: konfirmasi URL mainnet scan saat register Lock Provider).
7. **Registration butuh 7TRUST credential** — 7LOCK minta link 7TRUST-verified
   domain saat register role. Selesaikan DNS verify 7TRUST dulu.
