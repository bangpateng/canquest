# CanQuest — Deployment Guide

## Final Architecture

```
Browser
  │
  ├── canquest.cc        ──► Vercel (Next.js — marketing)
  ├── app.canquest.cc    ──► Vercel (Next.js — dapp)     ← same Vercel project
  └── api.canquest.cc    ──► VPS 2 (NestJS API)
                               ├── PostgreSQL
                               ├── Redis
                               └── SSH tunnel ──► VPS 1 (Canton validator)
                                                   └── port 7575, 8080
```

---

## Step 1 — DNS Records

In your domain registrar (canquest.cc), add these records:

| Type  | Name            | Value                    | TTL  |
|-------|-----------------|--------------------------|------|
| A     | @               | 76.76.21.21 (Vercel IP)  | auto |
| A     | www             | 76.76.21.21 (Vercel IP)  | auto |
| CNAME | app             | cname.vercel-dns.com     | auto |
| A     | api             | 62.171.185.56            | 300  |

> Note: Vercel will give you the exact DNS values when you add the domain in their dashboard.
> Use those values — the IPs above are examples.

---

## Step 2 — VPS 2 Setup (62.171.185.56)

### 2a. Edit secrets FIRST on your local PC

Open `infra/env/api.env.production` and replace every `CHANGE_ME_*`:

```bash
# Generate secrets (run in PowerShell or any terminal):
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run that command 3 times — use the outputs for:
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `ADMIN_JWT_SECRET`

Also set:
- `CHANGE_ME_STRONG_PASSWORD` → your PostgreSQL password (same in deploy.sh line)
- `RESEND_API_KEY` → from resend.com

### 2b. Commit and push the updated infra files (NOT the .env files)

```bash
git add infra/ apps/web/middleware.ts apps/web/next.config.ts vercel.json
git commit -m "chore: add production deployment config"
git push
```

### 2c. SSH into VPS 2 and run deploy.sh

```bash
ssh root@62.171.185.56

# Clone repo
git clone YOUR_GIT_REPO_URL /var/www/canquest
cd /var/www/canquest

# Edit the two variables at the top of deploy.sh
nano infra/deploy.sh
# → Set REPO_URL and PG_PASSWORD

# Also copy and edit your production .env
cp infra/env/api.env.production apps/api/.env
nano apps/api/.env
# → Fill in all CHANGE_ME_* values

bash infra/deploy.sh
```

The script will pause and ask you to add an SSH key to VPS 1.
At that point, open a second terminal and:

```bash
# On your LOCAL PC:
ssh root@162.250.191.46
nano /root/.ssh/authorized_keys
# Paste the public key that deploy.sh printed
```

### 2d. Get SSL for the API

```bash
# After DNS is pointing to VPS 2:
certbot --nginx -d api.canquest.cc
# Follow prompts — choose to redirect HTTP to HTTPS
```

### 2e. Verify everything on VPS 2

```bash
pm2 status                                          # API should be online
systemctl status canton-tunnel                       # Tunnel to VPS 1
curl https://api.canquest.cc/api/health             # Should return 200
curl http://127.0.0.1:7575/livez                    # Canton JSON API via tunnel
```

---

## Step 3 — Vercel Setup (Frontend)

### 3a. Import project on vercel.com

1. Go to https://vercel.com/new
2. Import from GitHub → select your canquest repo
3. **Framework Preset**: Next.js (auto-detected)
4. **Root Directory**: leave as `/` (repo root — vercel.json handles the rest)
5. Click **Deploy**

### 3b. Add Environment Variables

In Vercel Dashboard → Project → Settings → Environment Variables:

| Key                     | Value                             | Environment  |
|-------------------------|-----------------------------------|--------------|
| `NEXT_PUBLIC_API_URL`   | `https://api.canquest.cc/api`     | Production   |
| `INTERNAL_API_URL`      | `https://api.canquest.cc/api`     | Production   |
| `JWT_ACCESS_SECRET`     | *(same value as in api.env)*      | Production   |

### 3c. Add Custom Domains

In Vercel Dashboard → Project → Settings → Domains:

1. Add `canquest.cc` → follow their DNS instructions
2. Add `app.canquest.cc` → follow their DNS instructions

Both domains point to the same Vercel project.
The Next.js middleware handles routing between them automatically.

### 3d. Trigger a redeploy

After adding env vars, redeploy:
```
Vercel Dashboard → Deployments → latest → Redeploy
```

---

## Updating After Code Changes

### Frontend (automatic)
Push to your main branch → Vercel auto-deploys in ~1 minute.

### Backend (manual — run on VPS 2)
```bash
cd /var/www/canquest
bash infra/redeploy.sh
```

---

## Useful Commands on VPS 2

```bash
pm2 status                   # Process status
pm2 logs canquest-api        # Live API logs
pm2 restart canquest-api     # Restart API
pm2 monit                    # CPU/RAM monitor

systemctl status canton-tunnel     # SSH tunnel status
systemctl restart canton-tunnel    # Restart tunnel

# Database
sudo -u postgres psql canquest_app
\dt                          # List tables

# Redis
redis-cli ping               # Should return PONG

# Nginx
nginx -t                     # Test config
systemctl reload nginx
```

---

## Domain Summary

| URL                            | What it does                    |
|--------------------------------|---------------------------------|
| `canquest.cc`                  | Marketing / landing page        |
| `app.canquest.cc`              | Dapp (quests, wallet, etc.)     |
| `app.canquest.cc/admin`        | Admin panel (password protected)|
| `api.canquest.cc/api`          | NestJS REST API                 |
| `api.canquest.cc/api/health`   | Health check                    |
