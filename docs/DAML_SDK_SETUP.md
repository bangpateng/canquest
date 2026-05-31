# DAML SDK Setup Guide — Local Development & Production

> **Tujuan:** Install DAML SDK di local PC (Windows), compile contract `.daml` → `.dar`, dan upload ke Canton Validator (VPS 1).

---

## Arsitektur Production

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Vercel/GitHub  │     │  VPS 2          │     │  VPS 1          │
│  (Frontend)     │     │  (Backend)      │     │  (Validator)    │
│                 │     │                 │     │                 │
│ Next.js Web     │     │ NestJS API      │     │ Canton Node     │
│ apps/web        │     │ PostgreSQL      │     │ Ledger API      │
│                 │     │ Redis           │     │ :7575           │
│                 │     │ SSH Tunnel      │     │                 │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  HTTPS                │  SSH tunnel           │
         │  (API calls)          │  :7575, :8080         │
         └───────────────────────┴───────────────────────┘
```

### Arsitektur Development (Local)

```
┌─────────────┐         ┌─────────────┐         ┌─────────────────┐
│  Local PC   │         │  VPS 2      │         │  VPS 1          │
│  (Windows)  │         │  (API/DB)   │         │  (Validator)    │
│             │         │             │         │                 │
│ DAML SDK    │         │ NestJS API  │         │ Canton Node     │
│ daml build  │         │ PostgreSQL  │         │ Ledger API      │
│ Next.js dev │         │ Redis       │         │ :7575           │
└──────┬──────┘         └──────┬──────┘         └────────┬────────┘
       │                       │                         │
       │  SSH tunnel           │  SSH tunnel             │
       │  :7575, :8080         │  :7575, :8080           │
       └───────────────────────┴─────────────────────────┘
```

---

## 1. Install dpm (Daml Package Manager)

> **Reference:** https://docs.canton.network/sdks-tools/cli-tools/dpm

`dpm` adalah CLI tool resmi untuk Canton development. Tool ini menggantikan `daml` CLI lama dan mengelola SDK installation, project scaffolding, compilation, testing, code generation, dan local development environments.

### 1.1 Prerequisites

- **VS Code** (recommended untuk development)
  - Download: https://code.visualstudio.com/download

- **Java JDK 17+** (dpm butuh Java)
  - Download: https://adoptium.net/
  - Verify: `java -version`
  - Pastikan `JAVA_HOME` sudah di-set

### 1.2 Install dpm

**Option A: Windows Installer (Recommended)**

Download dan jalankan Windows installer dari:
https://get.digitalasset.com/install/latest-windows.html

Installer akan otomatis install dpm SDK dan set PATH variable.

**Option B: Mac/Linux**

```bash
curl https://get.digitalasset.com/install/install.sh | sh
```

**Option C: Manual Installation**

Download binary dari releases page:
https://github.com/digital-asset/dpm/releases

Extract dan tambahkan ke PATH.

### 1.3 Verify Installation

```bash
dpm --version
# Expected: dpm version X.X.X

dpm version --active
# Shows currently active SDK version
```

### 1.4 Install SDK Version

Install SDK version yang specified di [`packages/daml/daml.yaml`](../packages/daml/daml.yaml:1):

```bash
cd packages/daml
dpm install package
```

Atau install specific version:

```bash
dpm install 3.3.0-snapshot.20250930.0
```

List all installed versions:

```bash
dpm version
```

List all available versions:

```bash
dpm version --all
```

---

## 2. Build DAML Project

### 2.1 Navigate ke Project Directory

```bash
cd packages/daml
```

### 2.2 Build Contract

```bash
dpm build
```

**Output:**
- File `.dar` akan dibuat di `.daml/dist/canquest-v2-0.1.0.dar`
- Package ID akan ditampilkan di console

### 2.3 Verify Build

```bash
ls -la .daml/dist/
# Should see: canquest-v2-0.1.0.dar
```

### 2.4 Get Package ID

Package ID ditampilkan di output `dpm build`. Atau inspect DAR file:

```bash
dpm damlc inspect .daml/dist/canquest-v2-0.1.0.dar --json | grep packageId
```

---

## 3. Upload DAR ke Canton Validator (VPS 1)

### 3.1 Setup SSH Tunnel

**Dari Local PC (Windows PowerShell):**

```powershell
# Jalankan tunnel ke VPS 1 (Validator)
ssh -N -L 7575:172.18.0.5:7575 -L 8080:172.18.0.7:80 root@162.250.190.204
```

Atau gunakan script:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/tunnel-testnet.ps1 -ParticipantIp 172.18.0.5 -NginxIp 172.18.0.7
```

**Verifikasi tunnel (terminal baru):**

```bash
curl http://127.0.0.1:7575/livez
# Expected: OK

curl -H "Host: wallet.localhost" http://127.0.0.1:8080/api/validator/v0/version
# Expected: JSON version info
```

### 3.2 Upload DAR Package

**Method 1: Via curl (REST API) - Recommended**

```bash
# Generate JWT token (hs-256-unsafe)
# Untuk TestNet, secret = "unsafe"

curl -X POST \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @.daml/dist/canquest-v2-0.1.0.dar \
  http://127.0.0.1:7575/v1/packages
```

**Method 2: Via Script**

```bash
node apps/api/scripts/ensure-quest-operator.cjs
```

Script ini akan:
1. Upload DAR jika belum ada
2. Setup operator party
3. Configure CANTON_OPERATOR_PARTY_ID

> **Note:** `dpm` tidak memiliki command `ledger upload-dar` seperti `daml` CLI lama. Upload DAR dilakukan via REST API atau script.

### 3.3 Verify Upload

```bash
# List uploaded packages
curl -H "Authorization: Bearer <JWT_TOKEN>" \
  http://127.0.0.1:7575/v1/packages
```

---

## 4. Update Environment Variables

Setelah upload DAR, update [`apps/api/.env`](../apps/api/.env:115):

```env
# 6d — DAML canquest-v2 (uploaded TestNet 2026-05-30)
QUEST_LEDGER_ENABLED=true
CLAIM_SESSION_LEDGER_ENABLED=true
CANTON_DAML_PACKAGE_ID=<PACKAGE_ID_DARI_BUILD>
```

Ganti `<PACKAGE_ID_DARI_BUILD>` dengan Package ID yang didapat dari step 2.4.

---

## 5. Troubleshooting

### 5.1 DAML Build Error

**Error:** `SDK version not found`

```bash
dpm install 3.3.0-snapshot.20250930.0
# atau
cd packages/daml
dpm install package
```

**Error:** `Java not found`

```bash
# Install Java JDK 17+
# Windows: Download dari https://adoptium.net/
# Verify: java -version
# Pastikan JAVA_HOME sudah di-set
```

### 5.2 Upload Error

**Error:** `Connection refused`

- Pastikan SSH tunnel aktif
- Verify: `curl http://127.0.0.1:7575/livez`

**Error:** `Unauthorized`

- Check JWT token/secret
- Untuk TestNet: secret = "unsafe"

**Error:** `Package already exists`

- Package sudah ter-upload, tidak perlu upload ulang
- Atau increment version di [`packages/daml/daml.yaml`](../packages/daml/daml.yaml:5)

### 5.3 Tunnel Issues

**Tunnel putus-nyambung:**

```bash
# Tambahkan ServerAliveInterval
ssh -N -o ServerAliveInterval=60 -o ServerAliveCountMax=3 \
  -L 7575:172.18.0.5:7575 -L 8080:172.18.0.7:80 \
  root@162.250.190.204
```

Lihat [`docs/CANTON_STABLE_CONNECTION.md`](./CANTON_STABLE_CONNECTION.md:1) untuk detail.

---

## 6. Development Workflow

### 6.1 Edit Contract

```bash
# Edit file .daml
code packages/daml/daml/CanQuest/Quest/Task.daml
```

### 6.2 Rebuild

```bash
cd packages/daml
dpm build
```

### 6.3 Re-upload (jika ada perubahan)

```bash
# Increment version di daml.yaml
# Lalu upload ulang via curl REST API
curl -X POST \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @.daml/dist/canquest-v2-<VERSION>.dar \
  http://127.0.0.1:7575/v1/packages
```

### 6.4 Update Package ID

Update `CANTON_DAML_PACKAGE_ID` di [`apps/api/.env`](../apps/api/.env:120) dengan Package ID baru.

### 6.5 Restart API

```bash
# Di VPS 2 atau local
cd apps/api
npm run start:dev
```

---

## 7. Production Deployment

### 7.1 Arsitektur Production

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Vercel/GitHub  │     │  VPS 2          │     │  VPS 1          │
│  (Frontend)     │     │  (Backend)      │     │  (Validator)    │
│                 │     │                 │     │                 │
│ Next.js Web     │     │ NestJS API      │     │ Canton Node     │
│ apps/web        │     │ PostgreSQL      │     │ Ledger API      │
│                 │     │ Redis           │     │ :7575           │
│                 │     │ SSH Tunnel      │     │                 │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  HTTPS                │  SSH tunnel           │
         │  (API calls)          │  :7575, :8080         │
         └───────────────────────┴───────────────────────┘
```

### 7.2 DAML SDK Tetap di Local PC

**DAML SDK hanya di-install di Local PC** untuk development:
- Compile contract `.daml` → `.dar`
- Upload package ke VPS 1 via SSH tunnel
- Testing dan debugging

**VPS 1 dan VPS 2 TIDAK perlu install DAML SDK:**
- VPS 1: Hanya menjalankan Canton validator container
- VPS 2: Hanya menjalankan API, database, dan tunnel

### 7.3 VPS 2 — Permanent SSH Tunnel ke VPS 1

Di VPS 2, jalankan SSH tunnel permanen menggunakan `systemd` atau `screen`/`tmux`:

**Option A: systemd service (Recommended)**

Buat file `/etc/systemd/system/canton-tunnel.service`:

```ini
[Unit]
Description=SSH Tunnel to Canton Validator (VPS 1)
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/ssh -N -o ServerAliveInterval=60 -o ServerAliveCountMax=3 \
  -L 7575:172.18.0.5:7575 -L 8080:172.18.0.7:80 \
  root@162.250.190.204
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable dan start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable canton-tunnel
sudo systemctl start canton-tunnel
sudo systemctl status canton-tunnel
```

**Option B: screen/tmux**

```bash
# Install screen jika belum ada
apt install screen -y

# Buat session baru
screen -S canton-tunnel

# Jalankan tunnel
ssh -N -o ServerAliveInterval=60 -o ServerAliveCountMax=3 \
  -L 7575:172.18.0.5:7575 -L 8080:172.18.0.7:80 \
  root@162.250.190.204

# Detach: Ctrl+A, D
# Reattach: screen -r canton-tunnel
```

### 7.4 VPS 2 — API Environment

Update [`apps/api/.env`](../apps/api/.env:80) di VPS 2:

```env
# Canton JSON Ledger API (via local tunnel)
CANTON_JSON_API_URL=http://127.0.0.1:7575

# Splice Validator API (via local tunnel)
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
```

API di VPS 2 akan connect ke `127.0.0.1:7575` dan `127.0.0.1:8080` yang di-forward ke VPS 1 via tunnel.

### 7.5 Vercel — Frontend Deployment

Frontend (`apps/web`) di-deploy ke Vercel via GitHub:

1. Push code ke GitHub repository
2. Connect Vercel ke GitHub repo
3. Vercel auto-deploy setiap push ke `main` branch

**Environment Variables di Vercel:**

```env
NEXT_PUBLIC_API_URL=https://api.canquest.cc
# atau URL API VPS 2 kamu
```

### 7.6 Workflow Summary

| Task | Location | Command/Action |
|------|----------|----------------|
| Develop DAML contract | Local PC | Edit `.daml` files |
| Build DAML | Local PC | `dpm build` |
| Upload DAR to VPS 1 | Local PC | `curl ... /v1/packages` (via tunnel) |
| Run API | VPS 2 | `pm2 start` atau `npm run start:prod` |
| Run tunnel | VPS 2 | `systemctl start canton-tunnel` |
| Deploy frontend | Vercel | Push to GitHub → auto-deploy |

---

## 8. Useful Commands

```bash
# Check dpm version
dpm --version

# Check active SDK version
dpm version --active

# List all installed SDK versions
dpm version

# List all available SDK versions
dpm version --all

# Install SDK version from daml.yaml
dpm install package

# Install specific SDK version
dpm install 3.3.0-snapshot.20250930.0

# Build project
dpm build

# Build all packages (multi-package project)
dpm build --all

# Run tests
dpm test

# Inspect DAR file
dpm damlc inspect .daml/dist/canquest-v2-0.1.0.dar

# Generate TypeScript bindings (optional)
dpm codegen js .daml/dist/canquest-v2-0.1.0.dar -o generated/js

# Start sandbox (local development)
dpm start
```

---

## 9. References

- [dpm CLI Documentation](https://docs.canton.network/sdks-tools/cli-tools/dpm)
- [M3 Dev Environment Setup](https://docs.canton.network/appdev/modules/m3-dev-environment)
- [DAML Documentation](https://docs.daml.com/)
- [Canton Network Docs](https://docs.canton.network/)
- [DAML_CONTRACTS_DOCUMENTATION.md](./DAML_CONTRACTS_DOCUMENTATION.md:1)
- [CANTON_TESTNET.md](./CANTON_TESTNET.md:1)
- [NETWORK_TOPOLOGY.md](./NETWORK_TOPOLOGY.md:1)

---

## Summary

| Step | Command | Location |
|------|---------|----------|
| 1. Install dpm | Download Windows installer from `get.digitalasset.com` | Local PC |
| 2. Install SDK | `dpm install package` | `packages/daml/` |
| 3. Build | `dpm build` | `packages/daml/` |
| 4. Tunnel | `ssh -N -L 7575:... -L 8080:... root@162.250.190.204` | Local PC |
| 5. Upload | `curl -X POST ... /v1/packages` | Local PC |
| 6. Update .env | Set `CANTON_DAML_PACKAGE_ID` | `apps/api/.env` |
| 7. Restart API | `npm run start:dev` | VPS 2 / Local |
