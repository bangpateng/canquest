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

With the [DAML SDK](https://docs.digitalasset.com/) installed:

```bash
cd packages/daml
daml build
```

Align `sdk-version` in `daml.yaml` with the SDK you install.
