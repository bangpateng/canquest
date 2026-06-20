# Grounding Create TransferPreapproval via Ledger — Consolidated Report

**DATA NYATA dari VPS** — Bukan estimasi. Semua sumber: exercised event + scan-proxy + ACS.

**Env Variables relevan:**
- `CANTON_SCAN_URL=http://127.0.0.1:8080/api/validator/v0/scan-proxy`
- `CANTON_DSO_PARTY_ID=DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc`
- `CANTON_FEE_PARTY_ID=canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb`
- `CANTON_VALIDATOR_PARTY_ID=canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb`
- `LEDGER_API_URL=https://api-ledger-canquest.nodelab.my.id`
- `LEDGER_AUTH_MODE=keycloak`

---

# SECTION A: Exercised Event `AmuletRules_CreateTransferPreapproval` (GROUND TRUTH)

Ini adalah data **paling akurat** — diambil langsung dari exercised event di ledger VPS.

## A.1 Event Details

- **Offset:** 838791
- **Update ID:** `12206cba0229a9db7343dd4d6fba01bea86392fe49743cc1494d2e41835f2c9ea32e`
- **Command ID:** `org.lfdecentralizedtrust.splice.validator.acceptTransferPreapprovalProposal_c6b3d9327d3fb3347914ea48dc42e2fd6d079d46b185eaac141d9a68ec04f552`
- **Effective At:** `2026-06-10T09:26:29.140443Z`

## A.2 Choice Argument (REAL)

```json
{
  "context": {
    "amuletRules": "0024dafd9baae52bd9b8eb7fde587c500696f7350cb4f25e53fdfa18859c4a1c77ca12122072bfcaa7923d684c043279ff3eb6a8e520a1cc9e6a7269a03662a2817cf93c9e",
    "context": {
      "openMiningRound": "00b62b27d4f3b3068bdf612273e8d0469d16371248893e8cb61a5d8991aaa61e5dca121220857b644773cbb5c3e0a5bb9d29f859b4f043ab7d49d3b16fef415fb1b17a7826",
      "issuingMiningRounds": [],
      "validatorRights": []
    }
  },
  "inputs": [
    {
      "tag": "InputAmulet",
      "value": "004a8533e56b3b9dd154194db6a13fbe58cf25b2af0d519623314743f40a8de6ffca121220a4659b3871132c2ef70db08b5349794753276a63ee2df253ee0c421a83656fa7"
    }
  ],
  "receiver": "canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  "provider": "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  "expiresAt": "2026-09-08T09:26:29.081459Z",
  "expectedDso": "DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc"
}
```

## A.3 Acting Parties (REAL)

```json
[
  "canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb"
]
```

**KEDUA** receiver + provider jadi actAs.

## A.4 Exercise Result

```json
{
  "transferPreapprovalCid": "00e3e19a3902e5befbb84613b4fda162856ad9c0e74571fbd624fe83733e0d498cca12122076828c93c5241b6f6d50e3534cd0946595f11aff9a624c6a58c35c4ff537e9c4",
  "transferResult": {
    "round": { "number": "99674" },
    "summary": {
      "inputAppRewardAmount": "0.0000000000",
      "inputValidatorRewardAmount": "0.0000000000",
      "inputSvRewardAmount": "0.0000000000",
      "inputAmuletAmount": "162.5554280949",
      "balanceChanges": [
        [
          "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
          {
            "changeToInitialAmountAsOfRoundZero": "-1.5425794149",
            "changeToHoldingFeesRate": "-0.0000004389"
          }
        ]
      ],
      "holdingFees": "0.0000000000",
      "outputFees": ["0.0000000000"],
      "senderChangeFee": "0.0000000000",
      "senderChangeAmount": "161.0503011534",
      "amuletPrice": "0.1638400000",
      "inputValidatorFaucetAmount": "0.0000000000",
      "inputUnclaimedActivityRecordAmount": "0.0000000000",
      "inputDevelopmentFundAmount": "0.0000000000"
    }
  },
  "amuletPaid": "1.5051269415"
}
```

**Fee yang dibayar:** **1.5051269415 CC** dari provider's Amulet holdings.

## A.5 Key Findings dari Exercised Event

**Field yang ADA di choice argument:**
- ✅ `context` (nested: `amuletRules` + `context.openMiningRound` + `issuingMiningRounds` + `validatorRights`)
- ✅ `inputs` (array of `InputAmulet` — provider's Amulet holdings untuk burn fee)
- ✅ `receiver`, `provider`, `expiresAt`, `expectedDso`

**Field yang TIDAK ADA:**
- ❌ `validFrom` — auto-generated saat create
- ❌ `lastRenewedAt` — auto-generated saat create
- ❌ `dso` (pakai `expectedDso`)

**Struktur `context`:**
```
context: {
  amuletRules: "<amuletRulesCid>",
  context: {           // ← Nested context (bukan typo, ini struktur DAML)
    openMiningRound: "<cid>",
    issuingMiningRounds: [],
    validatorRights: []
  }
}
```

---

# SECTION B: ACS Query Data (REAL DATA dari scan-proxy + ACS)

## B.1 TransferPreapproval canquest-fee

**Template ID:** `a31be0483f3175647053f28965a4e6d97e3dbc433ea2338be303fae69bbcff6a:Splice.AmuletRules:TransferPreapproval`

**createArgument (dari ACS):**
```json
{
  "dso": "DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc",
  "receiver": "canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  "provider": "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  "validFrom": "2026-06-10T09:26:29.140443Z",
  "lastRenewedAt": "2026-06-10T09:26:29.140443Z",
  "expiresAt": "2026-09-08T09:26:29.081459Z"
}
```

**CATATAN:** ACS menyimpan field `dso`, `validFrom`, `lastRenewedAt` — ini adalah **hasil stored contract**, bukan input. Input hanya `expectedDso`, `receiver`, `provider`, `expiresAt`.

## B.2 DSO Party ID

**Scan-proxy response:** `DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc`  
**Matches `CANTON_DSO_PARTY_ID`:** ✅ YES

## B.3 AmuletRules Contract

- **Template ID:** `6c5802f86709a0ad4784af81f0bab40f3070b2f58128d8843da1e1784c147802:Splice.AmuletRules:AmuletRules`
- **Contract ID:** `0024dafd9baae52bd9b8eb7fde587c500696f7350cb4f25e53fdfa18859c4a1c77ca12122072bfcaa7923d684c043279ff3eb6a8e520a1cc9e6a7269a03662a2817cf93c9e`
- **`transferPreapprovalFee`:** `null` (tidak ada fee untuk create preapproval)

## B.4 OpenMiningRound Contract (latest)

- **Template ID:** `a31be0483f3175647053f28965a4e6d97e3dbc433ea2338be303fae69bbcff6a:Splice.Round:OpenMiningRound`
- **Contract ID (latest):** `007a59d3681defc51132569ea5246b7c2f9fc17c7c06710ec6381bf50463f5fae6ca121220af127d517e14cbc2be6975fc1a2499e475c290fee391e4e36b59a249e9df4c88`
- **Round number:** 101007
- **Amulet price:** 0.154369

**CATATAN:** OpenMiningRound contract ID di exercised event (Section A) **BERBEDA** dengan yang latest dari scan-proxy, karena round sudah berganti. Harus selalu ambil yang **LATEST** dari scan-proxy endpoint `/open-and-issuing-mining-rounds`.

## B.5 Provider Amulet Holdings

**Provider:** `canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb`  
**Jumlah holdings:** 1 contract  
**Total CC:** 156.8312155057 CC (cukup untuk bayar fee 1.5051269415 CC)

---

# SECTION C: Script untuk Reproduksi Data

Script Node.js untuk query data NYATA dari VPS: `apps/api/scripts/query-preapproval-data.cjs`

```javascript
// Query ACS untuk TransferPreapproval canquest-fee, AmuletRules, OpenMiningRound
// Jalankan: cd apps/api && node scripts/query-preapproval-data.cjs
```

Script probe create event: `apps/api/scripts/probe-create-event.cjs`

```javascript
// Probe exercised event AmuletRules_CreateTransferPreapproval via Ledger /v2/updates
```

---

# SECTION D: Arg Shape FINAL untuk Implementasi

## D.1 Choice Argument (berdasarkan Exercised Event)

```typescript
{
  context: {
    amuletRules: "<amuletRulesCid dari scan-proxy>",
    context: {
      openMiningRound: "<openMiningRoundCid dari scan-proxy>",
      issuingMiningRounds: [],
      validatorRights: [],
    },
  },
  inputs: [
    {
      tag: "InputAmulet",
      value: "<providerAmuletHoldingCid dari queryAmuletHoldings>",
    },
  ],
  receiver: receiverPartyId,
  provider: "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  expectedDso: "DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc",
}
```

## D.2 actAs

```typescript
[
  receiverPartyId,  // User yang mau aktifkan preapproval
  "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",  // Provider
]
```

## D.3 Disclosed Contracts

1. **AmuletRules** (dari scan-proxy `/amulet-rules`)
   - contractId + templateId + createdEventBlob
2. **OpenMiningRound** (dari scan-proxy `/open-and-issuing-mining-rounds`)
   - contractId + templateId + createdEventBlob

## D.4 Provider Amulet Holdings (untuk inputs)

Query via `queryAmuletHoldings(providerPartyId)` untuk dapatkan `holdingCid`.

---

# SECTION E: Perbandingan — Estimasi Awal vs Real Data

| Aspek | Estimasi Awal | Real Data (Exercised) | Real Data (ACS) |
|-------|--------------|----------------------|-----------------|
| Field arg | `dso` | `expectedDso` | `dso` (stored) |
| Field arg | `validFrom` | ❌ Tidak ada (auto) | `validFrom` (stored) |
| Field arg | `lastRenewedAt` | ❌ Tidak ada (auto) | `lastRenewedAt` (stored) |
| `context` | `{ amuletRules, openMiningRound }` | `{ amuletRules, context: { openMiningRound, ... } }` (nested) | N/A |
| `inputs` | `[{ contractId, amount }]` | `[{ tag: "InputAmulet", value: "<cid>" }]` | N/A |
| actAs | `[provider]` | `[receiver, provider]` (KEDUA) | N/A |

---

# SECTION F: Next Steps

1. **Implement `createTransferPreapprovalViaLedger(receiverPartyId)`** di `canton-ledger.service.ts`:
   - Query scan-proxy `/amulet-rules` + `/open-and-issuing-mining-rounds` untuk get disclosed contracts
   - Query `queryAmuletHoldings(providerPartyId)` untuk get provider's Amulet holdings
   - Rakit `choiceArguments` dengan struktur dari Exercised Event (Section D)
   - Exercise choice `AmuletRules_CreateTransferPreapproval` dengan disclosed contracts
   - actAs: `[receiverPartyId, providerPartyId]`

2. **Wire ke `/party/preapproval/enable`** di `party.controller.ts`:
   - Replace `splice.createTransferPreapproval()` (HS256) → `ledger.createTransferPreapprovalViaLedger()` (Keycloak)

3. **Test:**
   - User enable preapproval → `/party/preapproval/enable` sukses
   - User disable preapproval → `/party/preapproval/disable` sukses
   - Transfer ke user dengan preapproval → `kind=direct`
   - Transfer ke user tanpa preapproval → `kind=offer`