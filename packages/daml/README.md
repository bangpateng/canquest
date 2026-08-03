# CanQuest DAML v22

Package DAML baru (`canquest-v22`) yang menggantikan v21 (dead code, ledger bersih - FRESH START).

## 3 Template

| Template | Tujuan | Choice |
|---|---|---|
| `WalletRegistration` | Jangkar identitas on-chain user | (create-only) |
| `QuestCampaign` | Kuota FCFS/Raffle + state machine | `ClaimSlot`, `DrawWinner`, `Activate`, `Pause`, `EndCampaign`, `Close` |
| `QuestClaimReceipt` | Receipt + **atomic Settle** | `Settle`, `RecordTxId`, `RevealCode`, `Expire` |

## Atomicity (Settle)

`Settle` melakukan **nested exercise** dalam 1 transaction tree:
1. `TransferFactory_Transfer` (fee: user → treasury)
2. `TransferFactory_Transfer` (reward: rewardParty → user)
3. `FeaturedAppRight_CreateActivityMarker` (optional, bila FAR on)

Backend submit command dengan:
- `actAs` = `[operator, userAddress, rewardParty]` (FAR off)
- `actAs` = `[operator, userAddress, rewardParty, appProvider]` (FAR on)

Pre-step backend (sebelum submit Settle):
1. `callTransferFactoryRegistry` → `feeChoiceContext`, `feeFactoryCid`
2. `callTransferFactoryRegistry` → `rewardChoiceContext`, `rewardFactoryCid`
3. `queryAmuletHoldings` / `getTokenHoldingCids` → `inputHoldingCids`
4. (optional) `getFeaturedAppRightCid` → `farCid`

## Tx ID Limitation

`TransferFactory_Transfer` return `TransferInstructionResult` (record), **bukan tx ID**.
Tx ID tidak bisa didapat dari dalam choice. Maka:
- `Settle` hanya set boolean `feePaid`/`rewardSent` + create settled receipt
- Backend baca tx ID dari Ledger API response setelah atomic command sukses
- Backend exercise `RecordTxId` untuk isi `feeTxId`/`rewardTxId`

## DAML Boundary

| Yang di DAML | Yang di CIP-56 / backend |
|---|---|
| Anti-sybil kuota FCFS/Raffle | Lock/unlock CC |
| State machine campaign | Swap OneSwap |
| Idempotency (contract key) | Send CC/USDCx P2P |
| Atomic settle (quest reward) | Preapproval |
| Receipt + audit | commandId dedup |

## Prasyarat Build

### 1. Install DAML SDK 3.4.11
```bash
# Mac/Linux
curl -sSL https://get.daml.com/ | sh -s -- 3.4.11
daml --version   # harus 3.4.11
```

### 2. Extract DAR dependencies dari participant node (PENTING!)

DAML v22 butuh 4 DAR Splice API sebagai `data-dependencies`. **WAJIB extract dari participant node VPS 1 Anda** (bukan download dari release bundle berbeda - akan break ABI compat).

Di VPS 1 (atau mana saja yang bisa reach ledger):

```bash
# Set env (auto-load apps/api/.env kalau di VPS 2)
export LEDGER_API_URL="https://ledger.canquestlabs.com"
export LEDGER_CLIENT_ID="<dari .env>"
export LEDGER_CLIENT_SECRET="<dari .env>"

# Ambil token
TOKEN=$(curl -s -X POST "https://auth.canquestlabs.com/realms/canton/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$LEDGER_CLIENT_ID" \
  --data-urlencode "client_secret=$LEDGER_CLIENT_SECRET" \
  --data-urlencode "scope=daml_ledger_api" | jq -r .access_token)

# List semua package ID
curl -s -H "Authorization: Bearer $TOKEN" \
  "$LEDGER_API_URL/v2/packages" | jq -r '.packageIds[]'

# Cari package ID untuk splice-api-token-transfer-instruction-v1
# (cek sourceDescription / nama via /v2/packages/{id})
# Lalu download masing-masing DAR
```

4 DAR yang dibutuhkan (taruh di `packages/daml/dars/`):
- `splice-api-token-transfer-instruction-v1.dar`
- `splice-api-token-holding-v1.dar`
- `splice-api-token-metadata-v1.dar`
- `splice-api-featured-app-v2.dar`

> Lihat `dars/` folder. Sudah ada `splice-amulet-current.dar` dan `splice-wallet-0.1.9.dar` (referensi).

## Build & Upload

```bash
# Build
cd packages/daml
daml build

# Output: .daml/dist/canquest-v22-1.0.0.dar

# Upload ke participant (VPS 1)
TOKEN=$(<ambil dari Keycloak seperti di atas>)
curl -X POST "$LEDGER_API_URL/v2/packages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @.daml/dist/canquest-v22-1.0.0.dar

# Verify
curl -s -H "Authorization: Bearer $TOKEN" \
  "$LEDGER_API_URL/v2/packages" | jq '.packageIds | length'
# Harus +1 dari sebelum upload
```

## Switch Backend

Setelah DAR v22 ter-deploy, update `apps/api/.env`:
```bash
CANTON_DAML_PACKAGE_NAME=canquest-v22
# Sebelumnya: canquest-v20 (default fallback kode)
```

Lalu code change di `apps/api/src/canton/quest-ledger.service.ts`:
- Ganti `TPL.QuestClaim` → `TPL.QuestClaimReceipt`
- Ganti choice names: `ClaimFcfsSlot` → `ClaimSlot`, `DrawRaffleWinner` → `DrawWinner`, dll
- Tambah field `rewardToken`, `rewardAmount` (bukan `rewardCc` lagi)
- Tambah method `settleAtomic()` baru (nested exercise)
- Tambah method `recordTxId()` baru (post-settle)

Restart API:
```bash
cd /var/www/canquest/apps/api
pm2 restart canquest-api --update-env
```

## Test

```bash
cd packages/daml
daml test
```

Test suite akan ditulis terpisah (Test.daml v22) setelah Main.daml stabil.

## Review Canton AI

DAML ini ditulis berdasarkan:
- Inventory onchain dapp (DAPP_FUNCTIONS_AND_FAR.md)
- Signature exact dari Canton AI (TransferFactory_Transfer, ExtraArgs, FAR)
- Party real (canquest-operator, canquest-reward-user, canquest-fee, app-canquest)
- Backend field mapping (quests.service.ts, quest-ledger.service.ts)

**Sebelum build/production**, review ke Canton AI untuk cek:
- DAML idiom (apakah ada pattern lebih bersih)
- Authorization edge case
- Contract key maintenance (archive + recreate pattern)
- FAR v2 signature (`weight` field di AppRewardBeneficiary)

## Status

- [x] daml.yaml (dependencies + data-dependencies)
- [x] Main.daml (3 template + atomic Settle)
- [ ] Extract DAR dependencies dari participant node
- [ ] Build (`daml build`)
- [ ] Test (`daml test`)
- [ ] Upload DAR ke VPS 1
- [ ] Switch backend (quest-ledger.service.ts refactor)
- [ ] Production rollout
