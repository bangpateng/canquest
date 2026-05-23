# CanQuest DAML package

This folder holds DAML sources for Canton. **Implement real templates, signatories, and choices using [Digital Asset documentation](https://docs.digitalasset.com/build/3.5/index.html)**—do not treat `Placeholder` as production logic.

Suggested layout (from `work.md`):

- `User/` — `UserAccount`, `PartyBinding`
- `Quest/` — `QuestCampaign`, `QuestTask`, `QuestCompletion`
- `Reward/` — `RewardPool`, `SpinReward`
- `Wallet/` — `TransferRequest`, `TreasuryFee`
- `Admin/` — `AdminPermission`
- `Audit/` — `AuditLog`

## Build

With the [DAML SDK](https://docs.digitalasset.com/) installed (match `sdk-version` in `daml.yaml`, currently **3.3.0**):

```bash
cd packages/daml
daml build
```

Output: `.daml/dist/canquest-0.1.0.dar`

## `CANTON_DAML_PACKAGE_ID` — what it is

It is the **main package ID** (64-character hex hash) of that `.dar` after it is compiled. The API uses it to create contracts, e.g.:

`{packageId}:Main:QuestParticipation`

Without this env var, quest submit still works in PostgreSQL, but **no on-chain DAML proof**.

## Get the package ID (after `daml build`)

```bash
cd packages/daml
daml damlc inspect-dar .daml/dist/canquest-0.1.0.dar
```

Look for **`main package id:`** in the output, or JSON:

```bash
daml damlc inspect-dar --json .daml/dist/canquest-0.1.0.dar
```

Copy `main_package_id` into `apps/api/.env`:

```env
CANTON_DAML_PACKAGE_ID=47fc5f9b...your64hex...
CANTON_OPERATOR_PARTY_ID=naxweb-validator-1::12200dd7e3932d1c7cba834862f5faa97e3afd63f5d8085e4f5a85aba22cbdeaa016
```

(`CANTON_OPERATOR_PARTY_ID` = same as `CANTON_VALIDATOR_PARTY_ID` / app provider on your node.)

## Upload DAR to the participant (ledger must be reachable)

With SSH tunnel to participant JSON API (port **7575**):

```bash
# DevNet / hs-256-unsafe — adjust host/port to your tunnel
daml ledger upload-dar \
  --host 127.0.0.1 --port 7575 \
  .daml/dist/canquest-0.1.0.dar
```

Or use the HTTP packages API per [Manage Daml packages](https://docs.digitalasset.com/build/3.4/sdlc-howtos/applications/develop/manage-daml-packages.html).

Restart the Nest API after updating `.env`.

Docs: [Choose Your Path](https://docs.canton.network/appdev/get-started/choose-your-path) · [Module 3 contracts](https://docs.canton.network/appdev/modules/m3-dev-environment)
