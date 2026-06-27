# CanQuest DAML package

Canton Network smart contracts for Quest (`/quest`) and Earn campaign (`/earn`) audit trails.

**Documentation:** [Canton Module 3 — Daml fundamentals](https://docs.canton.network/appdev/modules/m3-dev-environment)

## Module layout (Canton M3 building/packaging)

| Module | Template | Purpose |
|--------|----------|---------|
| `CanQuest.Quest.Participation` | `QuestParticipation` | User started a quest (key: user + questId) |
| `CanQuest.Quest.Task` | `QuestTaskSubmission` | Verified task proof (key: user + questId + taskId) |
| `CanQuest.Quest.Completion` | `QuestCompletion` | Quest finished certificate |
| `CanQuest.Quest.Reward` | `QuestReward` | CC entitlement; `QuestReward_MarkClaimedWithTx` after CIP-56 payout |
| `CanQuest.Reward.ClaimSession` | `ClaimSession` | FCFS/invite claim state machine (INIT → FEE_PAID → REWARD_SENT) |

**Authorization model (M3):** operator = signatory, user = observer. Operator backend submits via JSON Ledger API; user sees all audit contracts.

## Build (Windows — tanpa install DAML SDK)

Anda **tidak perlu** `daml` di PATH. Pakai **Docker** (sudah ada script di repo):

```powershell
cd apps\api
npm run daml:build
```

Output: `packages\daml\.daml\dist\canquest-0.1.3.dar`

Ambil **package ID** (64 hex):

```powershell
docker run --rm -v "${PWD}\..\..\packages\daml:/project" -w /project digitalasset/daml-sdk:3.3.0-snapshot.20250930.0 bash -lc "/home/daml/.daml/bin/daml damlc inspect-dar .daml/dist/canquest-0.1.3.dar"
```

Cari baris `main package id:` di output.

## Deploy ke mana?

DAR **tidak** di-deploy ke Vercel/web. DAR di-upload ke **Canton Participant** pada validator node Anda (TestNet/MainNet). Detail infrastruktur (host, tunnel, port mapping, party IDs validator) bersifat **privat** — lihat runbook internal, jangan di-commit ke repo public.

Setelah DAR ter-upload, isi di `apps/api/.env`:

```env
CANTON_DAML_PACKAGE_ID=<main package id dari inspect-dar>
CANTON_VALIDATOR_PARTY_ID=<party id validator wallet>
CANTON_OPERATOR_PARTY_ID=<party id DAML signatory, via Splice user canquest-operator>
QUEST_LEDGER_ENABLED=true
CLAIM_SESSION_LEDGER_ENABLED=true
```

Restart API: `npm run start:dev` (dev) atau `pm2 restart canquest-api` (production).

---

## Build (Linux / VPS — DAML SDK terinstall)

```bash
cd packages/daml
daml build
daml test
```

## API integration

| Event | DAML action |
|-------|-------------|
| Task verified | `QuestTaskSubmission` + ensure `QuestParticipation` |
| Quest submit (earn hub) | `QuestCompletion` (+ `QuestReward` if rewardCc > 0) |
| FCFS / draw CC claim | `ClaimSession` + completion sync + mark reward claimed |
| Auto CC enqueue | `QuestReward_MarkClaimedWithTx` after Splice transfer |

See `apps/api/src/canton/quest-ledger.service.ts`.

## Template IDs (JSON Ledger API)

After deploy, templates are referenced as:

```
{packageId}:CanQuest.Quest.Participation:QuestParticipation
{packageId}:CanQuest.Quest.Task:QuestTaskSubmission
{packageId}:CanQuest.Quest.Completion:QuestCompletion
{packageId}:CanQuest.Quest.Reward:QuestReward
{packageId}:CanQuest.Reward.ClaimSession:ClaimSession
```
