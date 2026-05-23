# Dev data reset — what to clean

Use this when iterating on quests/UI in **Web2 mode**. See [ARCHITECTURE_LAYERS.md](./ARCHITECTURE_LAYERS.md).

Wallet (create / send / receive CC via Splice) keeps working when tunnel + `CANTON_VALIDATOR_URL` are set.

---

## Quick disable quest DAML

In `apps/api/.env`:

```env
QUEST_LEDGER_ENABLED=false
# CANTON_DAML_PACKAGE_ID=...   # comment out optional
```

Restart API: `npm run dev:api`

---

## What to reset (by layer)

| Layer | What | How | Wallet impact |
|-------|------|-----|----------------|
| **PostgreSQL — quest progress** | `QuestCompletion`, `QuestSubmission`, `WinnerDraw`, invite code assignments | `node scripts/reset-website-data.cjs --apply --quests` | None |
| **PostgreSQL — wallet history mirror** | `CcTransaction`, `CcBalance` | `--apply --wallet-history` | Balance refetches from Splice; bogus failed-send rows gone |
| **PostgreSQL — demo quests** | Quests with demo/test titles | `--apply --demos` | None |
| **PostgreSQL — test users** | All users except admin | `--apply --users` or `delete-users.cjs` | Deletes linked DB rows; **Canton party stays on validator** |
| **Single user quest retry** | One completion | `node scripts/reset-quest-completion.cjs email@x.com [questId]` | None |
| **Uploads** | Avatar files | Delete `apps/api/uploads/avatars/*` manually | None |
| **On-chain DAML** | Old `QuestParticipation` contracts | **Do not delete** from app; harmless when ledger disabled | None |
| **On-chain CC wallet** | `hilda::…` balance / transfers | **Keep** — real TestNet wallet | Yes |

---

## Recommended clean slate (local dev)

```powershell
cd apps\api

# Preview counts
node scripts\reset-website-data.cjs --dry-run --quests --wallet-history

# Execute
node scripts\reset-website-data.cjs --apply --quests --wallet-history

# Optional: remove demo quests + test accounts
node scripts\reset-website-data.cjs --apply --demos
node scripts\reset-website-data.cjs --apply --users
```

Optional duplicate tx cleanup:

```powershell
node scripts\dedupe-quest-wallet-txs.cjs --apply
```

---

## What you do **not** need to delete

- SSH tunnel / validator VPS config
- `CANTON_VALIDATOR_PARTY_ID`, operator party, Splice secrets (wallet)
- DAR file on participant (inactive while `QUEST_LEDGER_ENABLED=false`)
- Production domain env on VPS unless you deploy there too

---

## Re-enable DAML later

```env
QUEST_LEDGER_ENABLED=true
CANTON_DAML_PACKAGE_ID=<your package id>
CANTON_OPERATOR_PARTY_ID=canquest-operator::...
```

Run `node scripts/ensure-quest-operator.cjs` if operator party changed.
