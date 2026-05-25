# VPS 2 operations runbook — disconnects, health, deploy

> **For agents / future debugging:** When the user reports “ledger disconnected”, “wallet down”, or “site broken after refresh”, start here.  
> Related: [NETWORK_TOPOLOGY.md](./NETWORK_TOPOLOGY.md), [VPS2_DEPLOY.md](./VPS2_DEPLOY.md), [CANTON_STABLE_CONNECTION.md](./CANTON_STABLE_CONNECTION.md)

**Last verified stable:** 2026-05-25 — TestNet tunnel + API health OK on VPS 2 (`vmi3309107` / `62.171.185.56`).

---

## Machines (TestNet)

| Role | Host | Notes |
|------|------|--------|
| **VPS 2 — app** | `62.171.185.56` | Nest `:3001`, PM2 `canquest-api`, `canton-tunnel.service` |
| **VPS 1 — validator** | `162.250.190.204` | Docker: participant `172.18.0.6:7575`, nginx `172.18.0.7:80` |

`canton-tunnel` runs **only on VPS 2**, not on VPS 1.

---

## Symptom → likely cause (check in this order)

| User sees | Check first | Usual root cause |
|-----------|-------------|------------------|
| Whole site / wallet dead for everyone | `curl …/api/health` | **API down** — missing `apps/api/dist/main.js` after `git pull` + `pm2 restart` without build |
| Wallet slow / flaky under many refreshes | `curl …/api/health/canton` + env | SSH tunnel saturation + Splice sync too aggressive |
| **`429 Too Many Requests`** on `ledger-status`, `balance`, `fee-config` | Response body `ThrottlerException` | **Rate limit sengaja** (keamanan), tapi terlalu ketat jika: (1) `PartyController` pakai tier `ledger` 30/mnt, (2) BFF Vercel tanpa `X-Forwarded-For` → semua user satu IP. Fix: deploy API + **redeploy Vercel web** (forward IP), GET wallet `@SkipThrottle`, POST `send-cc` tetap ketat. |
| Deploy: `address already in use` on `:5432` | `docker compose up` | Postgres **sudah jalan** di VPS. Lanjut: `bash scripts/deploy-vps2.sh --skip-docker` |
| Brief glitch (~seconds) | `journalctl -u canton-tunnel` | Manual `systemctl restart canton-tunnel` |
| Ledger OK on VPS 1, bad on VPS 2 | Tunnel from VPS 2 | Tunnel down or wrong Docker IPs in `-L` forwards |

**Important:** “Disconnect” is often **API offline**, not Canton broken.

---

## 60-second diagnosis (run on VPS 2)

```bash
# 1) API alive?
curl -sf http://127.0.0.1:3001/api/health && echo

# 2) Canton path (tunnel + Splice)
curl -sf http://127.0.0.1:3001/api/health/canton && echo

# 3) Tunnel direct
curl -sf http://127.0.0.1:7575/livez; echo exit:$?

# 4) Build artifact exists?
test -f /var/www/canquest/apps/api/dist/main.js && echo "dist OK" || echo "dist MISSING — run build"

# 5) PM2
pm2 list
pm2 logs canquest-api --lines 40 --nostream
```

**Healthy `health/canton` example (2026-05-25):**

```json
{"ok":true,"checkMs":335,"splice":{"reachable":true},"ledger":{"reachable":true},
 "balance":{"readFromDb":true,"backgroundDebounceMs":60000},
 "inboundSync":{"pollMs":120000}}
```

On **VPS 1** (validator only):

```bash
curl -sf http://172.18.0.6:7575/livez && echo " participant OK"
curl -sf -o /dev/null -w "nginx %{http_code}\n" http://172.18.0.7:80/
```

Re-verify Docker IPs after any `docker compose restart` on VPS 1:

```bash
docker inspect -f '{{.Name}} {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  $(docker ps -q) | grep -E 'participant|nginx'
```

Expected TestNet (May 2026): participant `172.18.0.6`, nginx `172.18.0.7`.

---

## PM2 error that means “rebuild required”

```text
Error: Cannot find module '/var/www/canquest/apps/api/dist/main.js'
```

**Fix:** build before PM2 start (see deploy below). Do **not** only `pm2 restart` after `git pull`.

---

## Production env (load tuning on VPS 2)

In `apps/api/.env`:

```env
BALANCE_READ_FROM_DB=true
BALANCE_BACKGROUND_DEBOUNCE_MS=60000
CC_INBOUND_SYNC_POLL_MS=120000
CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
```

After editing `.env`, reload PM2 env:

```bash
pm2 delete canquest-api
pm2 start infra/pm2.ecosystem.config.js --only canquest-api --env production
pm2 save
```

Confirm in logs: `CC inbound sync started (every 120000ms)` — not `30000ms`.

---

## Deploy rule (keeps production safe)

**Always on VPS 2 after `git pull`:**

```bash
cd /var/www/canquest
git pull
bash scripts/deploy-vps2.sh
# or: chmod +x scripts/deploy-vps2.sh && ./scripts/deploy-vps2.sh
```

Minimum if skipping full script:

```bash
npm ci
npm run build:api
test -f apps/api/dist/main.js
pm2 delete canquest-api
pm2 start infra/pm2.ecosystem.config.js --only canquest-api --env production
pm2 save
```

---

## `canton-tunnel.service` (VPS 2 only)

- Unit path: `/etc/systemd/system/canton-tunnel.service`
- Forwards: `127.0.0.1:7575` → `172.18.0.6:7575`, `127.0.0.1:8080` → `172.18.0.7:80` on VPS 1
- Should include: `ServerAliveInterval=30`, `Restart=always`
- Restart only when needed; each restart = few seconds ledger unavailable on VPS 2

```bash
sudo systemctl status canton-tunnel
sudo systemctl restart canton-tunnel
journalctl -u canton-tunnel -n 30 --no-pager
```

Optional watchdog (`/etc/cron.d/canton-tunnel-watch`):

```cron
*/2 * * * * root curl -sf --max-time 5 http://127.0.0.1:7575/livez >/dev/null || systemctl restart canton-tunnel
```

---

## What “safe for production” means (May 2026)

| OK now | Still a limit |
|--------|----------------|
| VPS 1 Canton healthy | Many concurrent wallet refreshes → slow/flaky (single SSH tunnel) |
| Tunnel + health/canton green | `git pull` without build → full outage |
| DB-first balance + 120s inbound sync | Long-term: WireGuard + socat on `10.66.66.1` (see [CANTON_STABLE_CONNECTION.md](./CANTON_STABLE_CONNECTION.md)) |

---

## Agent checklist when user asks again

1. Read this file + latest `pm2 logs` / `health` / `health/canton` output if user pastes it.
2. If `health` fails → build/deploy issue, not Canton.
3. If `health` OK but `health/canton` fails → tunnel or VPS 1 Docker.
4. If both OK but UX bad under load → confirm `pollMs` 120000 and debounce 60000; consider tunnel upgrade.
5. Never tell user to run `canton-tunnel` on VPS 1 — service is on VPS 2.
