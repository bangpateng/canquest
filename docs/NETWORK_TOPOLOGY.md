# CanQuest — network topology (read this first)

> **Full deploy (zero → production):** [GUIDE_DEPLOY_FULL.md](./GUIDE_DEPLOY_FULL.md)  
> **Tutorial deploy (ID):** [TUTORIAL_DEPLOY_INDONESIA.md](./TUTORIAL_DEPLOY_INDONESIA.md)  
> **API lambat / diagnosa:** [PERFORMANCE_API.md](./PERFORMANCE_API.md)

## Rule of thumb

| What | DevNet | TestNet | MainNet |
|------|--------|---------|---------|
| **App server (VPS 2)** | **Same IP** | **Same IP** | **Same IP** |
| **Validator / Canton VPS** | **Different IP** | **Different IP** | **Different IP** |
| Party IDs, secrets, DAML package | **Different** | **Different** | **Different** |
| Postgres / Redis on VPS 2 | Per environment* | Per environment* | Per environment* |

\*Use separate DB names or VPS 2 instances if you run multiple networks in parallel. For production you usually pick **one** network (e.g. TestNet) on VPS 2.

**VPS 2 does not change when you switch DevNet → TestNet → MainNet.**  
You only change **WireGuard peer (VPS 1 IP)**, **Docker Canton URLs** in `apps/api/.env`, and optionally the database name.

---

## VPS 2 — application (stable)

| Item | Value |
|------|--------|
| Public IP | **`62.171.185.56`** |
| Stack | Nginx, Next.js `:3000`, Nest `:3001`, Postgres, Redis |
| Docs | [VPS2_DEPLOY.md](./VPS2_DEPLOY.md) |

Domains (example): `canquest.cc` → A record → `62.171.185.56`

---

## Validator VPS — Canton + Splice (changes per network)

These are **different machines** (or different deployments). Never reuse party IDs or secrets across networks.

| Network | Validator public IP | Status in repo |
|---------|---------------------|----------------|
| **DevNet** (legacy) | `162.250.191.46` | **Deprecated** — do not use for new work |
| **TestNet** (current) | `162.250.190.204` | Active — [CANTON_TESTNET.md](./CANTON_TESTNET.md) |
| **MainNet** | *set when you have it* | Add IP to this table + new `api.env.mainnet.example` when ready |

### What you change when switching network

On **VPS 2** only (not the VPS 2 IP):

1. **WireGuard** on VPS 1 + VPS 2 — `Endpoint` = validator public IP for that network  
2. **`apps/api/.env`** — `CANTON_JSON_API_URL` / `CANTON_VALIDATOR_URL` = Docker IPs on VPS 1 (not `127.0.0.1` when using WG)  
3. **`apps/api/.env`** — copy from the right template:
   - TestNet → `infra/env/api.env.testnet.example`
   - MainNet → (future) `infra/env/api.env.mainnet.example`
4. Re-fetch on validator VPS:
   - `CANTON_SPLICE_SECRET`
   - `CANTON_VALIDATOR_PARTY_ID`, `CANTON_APP_PROVIDER_PARTY_ID`, `CANTON_OPERATOR_PARTY_ID`
   - `CANTON_DAML_PACKAGE_ID` (after `upload-daml-dar.cjs` on **that** participant)
5. Restart: `sudo systemctl restart wg-quick@wg0` + `pm2 delete canquest-api` + `pm2 start ...` (reload `.env`)

**Do not copy** `apps/api/.env` from DevNet to TestNet or MainNet without replacing all Canton fields.

---

## WireGuard pattern (production — recommended)

```
VPS 2 (10.66.66.2)     WireGuard VPN          VPS 1 (10.66.66.1)
API .env URLs    ──────────────────────────►  Docker participant :7575
  http://172.x.x.x:7575                        Docker nginx :80
```

- Templates: `infra/wireguard/wg0-vps1.conf.example`, `wg0-vps2.conf.example`  
- Full steps: [GUIDE_DEPLOY_FULL.md](./GUIDE_DEPLOY_FULL.md) Phase 2  
- VPS 2 `AllowedIPs` must include the **Docker subnet** on VPS 1 (e.g. `172.18.0.0/16`)

## SSH tunnel (optional / dev only)

```
127.0.0.1:7575 / :8080  ──SSH -L──►  participant / nginx
```

- **Local PC dev:** `scripts/tunnel-testnet.ps1`  
- **Legacy production:** `infra/systemd/canton-tunnel.service.example` — disable if using WireGuard

Docker **internal** IPs (`172.x.x.x`) differ per validator host — always re-run `docker inspect` on the **target** validator VPS after any rebuild.

---

## Env file map

| Environment | API env template | Canton doc |
|-------------|------------------|------------|
| Local + TestNet tunnel | `infra/env/api.env.testnet.example` | [CANTON_TESTNET.md](./CANTON_TESTNET.md) |
| VPS 2 production (generic) | `infra/env/api.env.production.example` | Point tunnel at chosen network IP |
| Web on VPS 2 | `infra/env/web.env.production.example` | — |

---

## Quick checklist before go-live

- [ ] Confirm which network: TestNet or MainNet (not DevNet `162.250.191.46`)
- [ ] WireGuard `Endpoint` = **that network’s validator IP**; `curl` to participant `livez` from VPS 2 OK
- [ ] `CANTON_*` party IDs from **that** validator only
- [ ] DAML DAR uploaded to **that** participant
- [ ] VPS 2 still `62.171.185.56` — DNS unchanged when switching Canton network

---

*When MainNet validator IP is known, add it to the table above and commit an `api.env.mainnet.example`.*
