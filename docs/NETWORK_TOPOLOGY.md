# CanQuest — network topology (read this first)

## Rule of thumb

| What | DevNet | TestNet | MainNet |
|------|--------|---------|---------|
| **App server (VPS 2)** | **Same IP** | **Same IP** | **Same IP** |
| **Validator / Canton VPS** | **Different IP** | **Different IP** | **Different IP** |
| Party IDs, secrets, DAML package | **Different** | **Different** | **Different** |
| Postgres / Redis on VPS 2 | Per environment* | Per environment* | Per environment* |

\*Use separate DB names or VPS 2 instances if you run multiple networks in parallel. For production you usually pick **one** network (e.g. TestNet) on VPS 2.

**VPS 2 does not change when you switch DevNet → TestNet → MainNet.**  
You only change **where the SSH tunnel points** and **Canton-related env vars** in `apps/api/.env`.

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

1. **`/etc/systemd/system/canton-tunnel.service`** — SSH `Host` = validator IP for that network  
2. **`apps/api/.env`** — copy from the right template:
   - TestNet → `infra/env/api.env.testnet.example`
   - MainNet → (future) `infra/env/api.env.mainnet.example`
3. Re-fetch on validator VPS:
   - `CANTON_SPLICE_SECRET`
   - `CANTON_VALIDATOR_PARTY_ID`, `CANTON_APP_PROVIDER_PARTY_ID`, `CANTON_OPERATOR_PARTY_ID`
   - `CANTON_DAML_PACKAGE_ID` (after `upload-daml-dar.cjs` on **that** participant)
4. Restart: `sudo systemctl restart canton-tunnel` + `pm2 restart all`

**Do not copy** `apps/api/.env` from DevNet to TestNet or MainNet without replacing all Canton fields.

---

## Tunnel pattern (always on VPS 2)

```
VPS 2 localhost          SSH tunnel              Validator VPS (IP varies)
127.0.0.1:7575    ──────────────────────────►   participant :7575
127.0.0.1:8080    ──────────────────────────►   splice nginx :80
```

- **Local PC dev:** same pattern via `scripts/tunnel-testnet.ps1` (tunnel to TestNet IP).  
- **Production:** `infra/systemd/canton-tunnel.service.example` on VPS 2.

Docker **internal** IPs (`172.x.x.x`) also differ per validator host — always re-run `docker inspect` on the **target** validator VPS after any rebuild.

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
- [ ] Tunnel `ExecStart` SSH host = **that network’s validator IP**
- [ ] `CANTON_*` party IDs from **that** validator only
- [ ] DAML DAR uploaded to **that** participant
- [ ] VPS 2 still `62.171.185.56` — DNS unchanged when switching Canton network

---

*When MainNet validator IP is known, add it to the table above and commit an `api.env.mainnet.example`.*
