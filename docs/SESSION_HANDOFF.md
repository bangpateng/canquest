# CanQuest — Session handoff (May 2026)

Use this file when resuming work after a break.

---

## Resume phrase

```
Lanjutkan CanQuest dari docs/SESSION_HANDOFF.md — baca handoff dulu, cek apa yang belum selesai, lalu lanjutkan.
```

---

## TestNet setup (162.250.190.204)

| Item | Value |
|------|--------|
| Participant IP | `172.18.0.6` |
| Nginx IP | `172.18.0.7` |
| Tunnel | `ssh -N -L 7575:172.18.0.6:7575 -L 8080:172.18.0.7:80 root@162.250.190.204` |
| Validator / app provider (`.env` 6c) | `administrator::1220019a22d31b3162d918a278b0fbb31cdd2f2a41b905b34362d9ea47cac064e1e1` |
| Quest DAML operator (`.env` 6c) | `canquest-operator::1220cc5cc83730c8d5fb167626147133848cf69be6962f143be0c39d3e11a8546e8d` |
| DAML package ID | `8c0c659cb1a9a21ac71712bc8890561edbecee3fb7a952b4a65f24f94cc67dbb` |

Full guide: [docs/CANTON_TESTNET.md](./CANTON_TESTNET.md)

---

## Completed this session

### Infra & dev
- TestNet tunnel + connectivity docs (`docs/CANTON_TESTNET.md`)
- `apps/api/.env` reorganized for TestNet; Splice auth (`CANTON_SPLICE_AUDIENCE`, `ledger-api-user`)
- DAML: `npm run daml:build` → DAR uploaded to participant
- `CANTON_DAML_PACKAGE_ID` set in `.env`

### App fixes
- Quest task spinner loop + wallet hint for party tasks
- Dashboard / API proxy timeouts (no infinite spinners)
- Login email normalize; hilda password reset for local dev
- **Failed CC send/receive** → no row in transaction history; API returns error

### User (local dev)
- `hilda@gmail.com` / `Canquest123!`
- Wallet: `hilda::1220cc5cc83730c8d5fb167626147133848cf69be6962f143be0c39d3e11a8546e8d`

### Code (quest ledger)
- `commandId` uses UUID (party IDs with `::` broke ledger submit)
- `grantUserRights(operator)` before DAML creates
- `ensure-quest-operator.cjs` — Splice user `canquest-operator` that can submit on global synchronizer
- `CANTON_OPERATOR_PARTY_ID` set to `canquest-operator::1220cc5c...` (not `administrator::` — that party lists on ledger but cannot submit)
- `test-quest-ledger-create.cjs` — valid `commandId` (no `+` in debug labels)

---

## Quest DAML (optional)

- Set `QUEST_LEDGER_ENABLED=false` in `apps/api/.env` to skip DAML contracts while iterating on UI/quests.
- Wallet (Splice CC) unchanged. Data reset guide: [docs/DEV_DATA_RESET.md](./DEV_DATA_RESET.md)

## Earn (new product — May 2026)

Founder spec: [docs/EARN_PRODUCT_SPEC.md](./EARN_PRODUCT_SPEC.md)

- **Routes:** Menu Earn → `/earn` (campaigns); menu Quest → `/quest` (Earn hub) — see `apps/web/lib/app-routes.ts`
- Redirects: `/quests` → `/earn`, `/quest/:id` → `/earn/:id`
- Points → redeem CC / waitlist / other (admin-editable)
- Streak check-in milestones 1,3,5,7,14,15,30 (admin-editable)
- Twitter verify via twitterAPI.io; wallet required
- Implementation phased (schema → UI → streak → redeem → Twitter API)

## Still pending / blocked

1. **E2E smoke** (manual): login → quest submit → wallet send/receive
4. **Optional**: DB `canquest_testnet` or delete bogus TRANSFER rows from before failed-send fix
5. **Git commit** — not requested yet

---

## Daily dev commands

```powershell
# Terminal 1 — tunnel (keep open)
cd "c:\Users\Bang Pateng\Documents\can"
powershell -ExecutionPolicy Bypass -File scripts\tunnel-testnet.ps1 -ParticipantIp 172.18.0.6 -NginxIp 172.18.0.7

# Terminal 2 — API
npm run dev:api

# Terminal 3 — Web
npm run dev:web

# Checks
cd apps\api
node scripts\check-canton-connectivity.cjs
node scripts/ensure-quest-operator.cjs
node scripts/test-quest-ledger-create.cjs "<userPartyId>"
```

---

## Key paths

| Area | Path |
|------|------|
| TestNet guide | `docs/CANTON_TESTNET.md` |
| API env | `apps/api/.env` |
| Quest ledger | `apps/api/src/canton/quest-ledger.service.ts` |
| Party / send CC | `apps/api/src/party/party.controller.ts` |
| Dashboard | `apps/web/components/app/dashboard-view.tsx` |
| Tunnel script | `scripts/tunnel-testnet.ps1` |

---

## Transcript

`C:\Users\Bang Pateng\.cursor\projects\c-Users-Bang-Pateng-Documents-can\agent-transcripts\ebf15548-6de4-4c1d-b4ba-6e8e3d662952\ebf15548-6de4-4c1d-b4ba-6e8e3d662952.jsonl`

---

*Last updated: May 2026 (TestNet + DAML upload session).*
