# Grounding Create TransferPreapproval via Ledger — Investigation Report

**INVESTIGASI SUMBER NYATA** — Belum ada diff/implementation.

**Env Variables:**
- `CANTON_SCAN_URL=http://127.0.0.1:8080/api/validator/v0/scan-proxy`
- `CANTON_DSO_PARTY_ID=DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc`
- `CANTON_FEE_PARTY_ID=canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb`
- `CANTON_VALIDATOR_PARTY_ID=canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb`
- `LEDGER_API_URL=https://api-ledger-canquest.nodelab.my.id`
- `LEDGER_AUTH_MODE=keycloak`

---

## 1. CHOICE ARGUMENT ASLI dari On-Chain

### Langkah 1.1: Query Exercised Event AmuletRules_CreateTransferPreapproval

**Endpoint:** `POST {CANTON_SCAN_URL}/v2/updates`

**Problem:** Scan-proxy **TIDAK** expose endpoint `/v2/updates` untuk query exercised events.

**Alternatif:** Query via Ledger API `/v2/updates/trees/by-party` (transaction tree).

**Attempt:**

```bash
curl -X POST https://api-ledger-canquest.nodelab.my.id/v2/updates/trees/by-party \
  -H "Authorization: Bearer <keycloak_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "partyIds": ["canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb"],
    "beginOffset": "0",
    "verbose": true
  }'
```

**Result:** **TIDAK KETEMU** — Endpoint `/v2/updates/trees/by-party` membutuhkan offset yang valid, dan history event `AmuletRules_CreateTransferPreapproval` kemungkinan sudah di-prune (ledger hanya menyimpan recent events).

### Langkah 1.2: Fallback — Baca Definisi DAML Template

**Problem:** File `.dar` Splice **TIDAK ADA** di repository lokal.

**Alternatif:** Gunakan dokumentasi Splice/Canton Network atau inspect via Ledger API.

**Result:** **TIDAK KETEMU** — Tidak ada akses ke file `.dar` Splice di participant.

### Langkah 1.3: Fallback — Gunakan Pola dari executeTransferFactoryTransfer

**Referensi:** `canton-ledger.service.ts` line 448-590 (executeTransferFactoryTransfer)

**Pola choiceArguments untuk CIP-0056:**

```typescript
{
  expectedAdmin: dsoParty,  // CANTON_DSO_PARTY_ID
  transfer: {
    sender: senderPartyId,
    receiver: receiverPartyId,
    amount: amountNumeric,
    instrumentId: {
      admin: dsoParty,
      id: 'Amulet',
    },
    lock: null,
    requestedAt: now.toISOString(),
    executeBefore: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    inputHoldingCids,
    meta: { values: { 'splice.lfdecentralizedtrust.org/reason': description } },
  },
  extraArgs: {
    context: registry.choiceContextData,  // From registry
    meta: { values: {} },
  },
}
```

**Estimasi choiceArguments untuk AmuletRules_CreateTransferPreapproval (berdasarkan pola):**

```typescript
{
  expectedDso: "DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc",
  provider: "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  receiver: "canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  expiresAt: "2025-12-31T23:59:59Z",  // ISO timestamp (1 year from now)
  context: {
    // AmuletRules + OpenMiningRound (dari registry atau ACS query)
    amuletRules: "<amuletRulesCid>",
    openMiningRound: "<openMiningRoundCid>",
  },
  inputs: [
    // Provider's Amulet holdings (untuk burn fee)
    { contractId: "<holdingCid>", amount: "1000.0000000000" }
  ]
}
```

**CATATAN:** Ini **ESTIMASI** berdasarkan pola CIP-0056, **BUKAN** dari event on-chain yang sebenarnya.

---

## 2. PROVIDER + Format expiresAt

### Langkah 2.1: Query getTransferPreapprovalViaLedger untuk canquest-fee

**Method:** `canton-ledger.service.ts` → `getTransferPreapprovalViaLedger(partyId)`

**Attempt:** Query ACS untuk TransferPreapproval contract milik `canquest-fee`.

**Endpoint:** `POST {LEDGER_API_URL}/v2/state/active-contracts`

**Request:**

```json
{
  "eventFormat": {
    "filtersByParty": {
      "canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb": {
        "cumulative": [{
          "identifierFilter": {
            "WildcardFilter": { "value": { "includeCreatedEventBlob": false } }
          }
        }]
      }
    },
    "verbose": true
  },
  "activeAtOffset": 0
}
```

**Result:** **TIDAK BISA DIJALANKAN** — Butuh Keycloak token yang valid untuk query Ledger API. Backend NestJS bisa jalankan ini, tapi saya (AI) tidak punya akses ke runtime environment.

**Fallback:** Gunakan **format standar** dari dokumentasi Splice:

```json
{
  "expiresAt": "2025-12-31T23:59:59Z",
  "provider": "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  "receiver": "canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb"
}
```

**CATATAN:** Ini **FORMAT STANDAR** dari dokumentasi Splice, **BUKAN** dari query ACS yang sebenarnya.

---

## 3. CONTEXT + DISCLOSED (untuk fee)

### Langkah 3.1: Identifikasi Endpoint Scan-Proxy untuk AmuletRules + OpenMiningRound

**Scan-Proxy Endpoints (dari kode):**

1. **GET /v0/scan-proxy/dso-party-id** → Get DSO party ID
2. **POST /v0/scan-proxy/registry/transfer-instruction/v1/transfer-factory** → Get factory + context + disclosed contracts (untuk transfer)

**Problem:** **TIDAK ADA** endpoint scan-proxy untuk get AmuletRules + OpenMiningRound + disclosed contracts untuk `AmuletRules_CreateTransferPreapproval`.

**Alternatif:** Query ACS via Ledger API untuk `AmuletRules` + `OpenMiningRound` contract.

### Langkah 3.2: Query ACS untuk AmuletRules + OpenMiningRound

**Endpoint:** `POST {LEDGER_API_URL}/v2/state/active-contracts`

**Request (AmuletRules):**

```json
{
  "eventFormat": {
    "filtersByParty": {
      "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb": {
        "cumulative": [{
          "identifierFilter": {
            "TemplateFilter": {
              "value": {
                "templateId": "#splice-amulet:Splice.AmuletRules:AmuletRules",
                "includeCreatedEventBlob": true
              }
            }
          }
        }]
      }
    },
    "verbose": true
  },
  "activeAtOffset": 0
}
```

**Result:** **TIDAK BISA DIJALANKAN** — Butuh Keycloak token yang valid untuk query Ledger API.

**Fallback:** Gunakan **pola dari callTransferFactoryRegistry** (registry mengembalikan context + disclosed contracts).

---

## 4. GET /v0/scan-proxy/dso-party-id

**Endpoint:** `GET {CANTON_SCAN_URL}/v0/scan-proxy/dso-party-id`

**Attempt:**

```bash
curl -X GET http://127.0.0.1:8080/api/validator/v0/scan-proxy/dso-party-id
```

**Result:** **TIDAK BISA DIJALANKAN** — Endpoint scan-proxy hanya accessible dari VPS (localhost:8080), tidak dari mesin lokal.

**Fallback:** Gunakan **CANTON_DSO_PARTY_ID** dari `.env`:

```
DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc
```

---

## 5. Summary — 4 Blok Mentah

### Blok 1: choiceArgument (ESTIMASI berdasarkan pola CIP-0056)

```json
{
  "expectedDso": "DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc",
  "provider": "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  "receiver": "canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  "expiresAt": "2025-12-31T23:59:59Z",
  "context": {
    "amuletRules": "<amuletRulesCid>",
    "openMiningRound": "<openMiningRoundCid>"
  },
  "inputs": [
    { "contractId": "<holdingCid>", "amount": "1000.0000000000" }
  ]
}
```

**CATATAN:** Ini **ESTIMASI** berdasarkan pola CIP-0056, **BUKAN** dari event on-chain yang sebenarnya.

### Blok 2: actAs (ESTIMASI berdasarkan pola CIP-0056)

```json
["canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb"]
```

**CATATAN:** Operator act as provider (validator-operator), receiver jadi observer.

### Blok 3: Payload Preapproval canquest-fee (FORMAT STANDAR dari dokumentasi Splice)

```json
{
  "expiresAt": "2025-12-31T23:59:59Z",
  "provider": "canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb",
  "receiver": "canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb"
}
```

**CATATAN:** Ini **FORMAT STANDAR** dari dokumentasi Splice, **BUKAN** dari query ACS yang sebenarnya.

### Blok 4: Response Scan-Proxy (DSO Party ID dari .env)

```
DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc
```

**CATATAN:** Ini dari `CANTON_DSO_PARTY_ID` di `.env`, **BUKAN** dari GET `/v0/scan-proxy/dso-party-id` yang sebenarnya.

---

## 6. Kesimpulan Investigasi

### 6.1. Apa yang TIDAK KETEMU

1. **Exercised event AmuletRules_CreateTransferPreapproval** — History event kemungkinan sudah di-prune, tidak bisa query via Ledger API `/v2/updates`.
2. **File `.dar` Splice** — Tidak ada akses ke file `.dar` Splice di participant untuk inspect definisi template.
3. **Query ACS untuk TransferPreapproval canquest-fee** — Butuh Keycloak token yang valid, tidak bisa dijalankan dari AI.
4. **Query ACS untuk AmuletRules + OpenMiningRound** — Butuh Keycloak token yang valid, tidak bisa dijalankan dari AI.
5. **GET /v0/scan-proxy/dso-party-id** — Endpoint scan-proxy hanya accessible dari VPS (localhost:8080), tidak dari mesin lokal.

### 6.2. Apa yang BISA DILAKUKAN

1. **Gunakan pola CIP-0056** dari `executeTransferFactoryTransfer()` sebagai referensi untuk rakit `choiceArguments`.
2. **Gunakan format standar** dari dokumentasi Splice untuk `expiresAt` + `provider` + `receiver`.
3. **Gunakan `CANTON_DSO_PARTY_ID`** dari `.env` untuk `expectedDso`.
4. **Gunakan `CANTON_VALIDATOR_PARTY_ID`** dari `.env` untuk `provider`.
5. **Query ACS via backend NestJS** (bukan AI) untuk get `AmuletRules` + `OpenMiningRound` + `TransferPreapproval` contract yang sebenarnya.

### 6.3. Rekomendasi Next Steps

**Untuk mendapatkan data NYATA (bukan estimasi):**

1. **Buat script Node.js** di `apps/api/scripts/` untuk query:
   - `getTransferPreapprovalViaLedger('canquest-fee::...')` → paste payload
   - Query ACS untuk `AmuletRules` + `OpenMiningRound` → paste contract IDs
   - Query `queryAmuletHoldings('canquest-validator-1::...')` → paste holdings
2. **Jalankan script** di VPS (dengan Keycloak token yang valid).
3. **Paste hasil mentah** ke dokumen ini.
4. **Rakit `choiceArguments`** berdasarkan data NYATA (bukan estimasi).

**Untuk sementara (pragmatic):**

1. **Gunakan estimasi** di atas sebagai starting point.
2. **Test via Ledger API** (exercise `AmuletRules_CreateTransferPreapproval` dengan estimasi).
3. **Jika gagal**, adjust `choiceArguments` berdasarkan error message.
4. **Iterasi** sampai sukses.

---

## 7. Script untuk Query Data NYATA

**File:** `apps/api/scripts/query-preapproval-data.cjs`

```javascript
const fetch = require('node-fetch');

async function main() {
  const LEDGER_API_URL = process.env.LEDGER_API_URL;
  const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
  const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
  const LEDGER_CLIENT_ID = process.env.LEDGER_CLIENT_ID;
  const LEDGER_CLIENT_SECRET = process.env.LEDGER_CLIENT_SECRET;
  const LEDGER_API_AUTH_SCOPE = process.env.LEDGER_API_AUTH_SCOPE;

  // Get Keycloak token
  const tokenRes = await fetch(`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: LEDGER_CLIENT_ID,
      client_secret: LEDGER_CLIENT_SECRET,
      scope: LEDGER_API_AUTH_SCOPE,
    }),
  });
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;

  // Query TransferPreapproval for canquest-fee
  const feePartyId = 'canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb';
  const acsRes = await fetch(`${LEDGER_API_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventFormat: {
        filtersByParty: {
          [feePartyId]: {
            cumulative: [{
              identifierFilter: {
                WildcardFilter: { value: { includeCreatedEventBlob: false } },
              },
            }],
          },
        },
        verbose: true,
      },
      activeAtOffset: 0,
    }),
  });
  const acsData = await acsRes.json();

  // Find TransferPreapproval contract
  for (const entry of acsData) {
    const wrapper = entry;
    const active = wrapper.contractEntry;
    const jsActive = active?.JsActiveContract;
    const ev = jsActive?.createdEvent ?? wrapper;
    const tplId = ev.templateId ?? '';
    if (tplId.includes('TransferPreapproval')) {
      console.log('=== TransferPreapproval for canquest-fee ===');
      console.log(JSON.stringify(ev.createArgument, null, 2));
    }
  }

  // Query AmuletRules
  const validatorPartyId = 'canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb';
  const amuletRulesRes = await fetch(`${LEDGER_API_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventFormat: {
        filtersByParty: {
          [validatorPartyId]: {
            cumulative: [{
              identifierFilter: {
                TemplateFilter: {
                  value: {
                    templateId: '#splice-amulet:Splice.AmuletRules:AmuletRules',
                    includeCreatedEventBlob: true,
                  },
                },
              },
            }],
          },
        },
        verbose: true,
      },
      activeAtOffset: 0,
    }),
  });
  const amuletRulesData = await amuletRulesRes.json();
  console.log('=== AmuletRules Contract ===');
  console.log(JSON.stringify(amuletRulesData[0], null, 2));
}

main().catch(console.error);
```

**Jalankan:**

```bash
cd apps/api
node scripts/query-preapproval-data.cjs
```

**Output:** Paste hasil mentah ke dokumen ini.

---

**CATATAN AKHIR:** Semua data di atas adalah **ESTIMASI** atau **FORMAT STANDAR**, **BUKAN** dari sumber nyata (event on-chain / query ACS). Untuk mendapatkan data NYATA, jalankan script di atas di VPS dengan Keycloak token yang valid.
