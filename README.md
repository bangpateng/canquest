# CanQuest monorepo

Enterprise Web3 quest platform (Canton + DAML + Next.js + NestJS). See `work.md` for the full product spec.

## Prerequisites

- Node.js 20+ (**64-bit recommended**; this repo uses Tailwind CSS v3 and Prisma settings compatible with 32-bit Windows where needed)
- Docker (for local PostgreSQL + Redis)
- DAML SDK (only for `packages/daml`)

## Quick start

```bash
# From repo root
docker compose up -d
cd apps/api && copy .env.example .env   # Windows: copy; Unix: cp
cd ../web && copy .env.local.example .env.local
cd ../..
npm install
npm run db:generate
npm run db:migrate -w api   # or: npm run prisma:push -w api
npm run dev:api
# other terminal
npm run dev:web
```

- Marketing site: [http://localhost:3000](http://localhost:3000) (`canquest.com` in production)
- Dapp shell: [http://localhost:3000/dashboard](http://localhost:3000/dashboard) (`app.canquest.com` in production)
- API health: [http://localhost:3001/api/health](http://localhost:3001/api/health)

## Production deploy (VPS + Vercel)

**Start here:** [docs/GUIDE_DEPLOY_FULL.md](docs/GUIDE_DEPLOY_FULL.md) — clone GitHub, WireGuard, VPS 1 validator, VPS 2 API, Vercel, smoke tests.

Also: [docs/NETWORK_TOPOLOGY.md](docs/NETWORK_TOPOLOGY.md), [docs/TUTORIAL_DEPLOY_INDONESIA.md](docs/TUTORIAL_DEPLOY_INDONESIA.md).

## Phase 1 (current)

- Monorepo layout, Docker Compose, design system, landing page, dapp shell
- NestJS auth: register → OTP (dev OTP in non-production) → verify → JWT + refresh token row
- `POST /api/party/username` — reserves username; Canton PartyId from Participant is TODO (Phase 3)

## Prisma on 32-bit Node

`apps/api` sets `PRISMA_CLIENT_ENGINE_TYPE=binary` in the `prisma:generate` script. If `prisma generate` still fails, use 64-bit Node.

## Web UI won’t open / browser spins forever

Typical on **low RAM or 32‑bit Node**:

1. Stop **all** old dev servers: Task Manager → end extra `node.exe` processes (including stuck ones using port 3000), or close prior terminals.
2. From the repo root run `npm run dev:web` again. If the terminal says **Port 3000 is in use**, open the **URL it prints** (e.g. `http://localhost:3002`) or free port 3000 first.
3. **`Array buffer allocation failed`** or **`out of memory` right after `npm run dev:web`**: check `node -p process.arch` — if **`ia32`**, you’re on **32‑bit Node**; use **`npm run dev:web:ia32`** (smaller heap) or preferably install **[64‑bit Node](https://nodejs.org)** and use **`npm run dev:web`**. webpack dev filesystem cache is already disabled in `next.config.ts`.
4. Fallback (no hot reload): **`npm run preview:web`** — builds then serves on port 3000 (close anything else using that port). If build complains about **`.next\\trace`** or **`EPERM`**, stop **all** Node/web dev processes first, delete **`apps/web/.next`**, then run **`npm run preview:web`** again.

Also try **`http://127.0.0.1:3000`** instead of `localhost` if IPv6 resolution misbehaves.
