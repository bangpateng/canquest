# Create TransferPreapproval via Ledger API — Investigation Report

**LAPORAN INVESTIGASI** — Belum ada diff/implementation.

---

## 1. Mekanisme executeTransferFactoryTransfer (Referensi)

**File:** `canton-ledger.service.ts` line 448-590

**Flow CIP-0056 Transfer:**

### Step 1: Query Sender's Amulet Holdings
```typescript
const holdings = await this.queryAmuletHoldings(senderPartyId);
const inputHoldingCids = holdings.map((h) => h.contractId);
```

**Purpose:** Get list of Amulet contract IDs owned by sender to fund the transfer.

### Step 2: Build choiceArguments
```typescript
const choiceArguments = {
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
    context: { values: {} },  // Will be replaced with registry's choiceContextData
    meta: { values: {} },
  },
};
```

### Step 3: Call Transfer Factory Registry
```typescript
const registry = await this.callTransferFactoryRegistry(choiceArguments);
// Returns:
// {
//   factoryId: string,
//   choiceContextData: Record<string, unknown>,
//   disclosedContracts: unknown[],
//   transferKind: 'direct' | 'offer'
// }
```

**Endpoint:** `POST /api/validator/v0/scan-proxy/registry/transfer-instruction/v1/transfer-factory`

**Purpose:** Get factory contract ID + choiceContextData (contains AmuletRules + OpenMiningRound) + disclosed contracts.

### Step 4: Inject choiceContextData
```typescript
(choiceArguments.extraArgs as Record<string, unknown>).context = registry.choiceContextData;
```

### Step 5: Exercise TransferFactory_Transfer
```typescript
await this.exerciseChoice(
  registry.factoryId,
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
  'TransferFactory_Transfer',
  choiceArguments,
  [senderPartyId],
  commandId,
  'submit-and-wait-for-transaction-tree',
  registry.disclosedContracts,  // CIP-0056: pass disclosed contracts
);
```

**Result:**
- `transferKind = 'direct'` → CC transferred immediately (receiver has preapproval)
- `transferKind = 'offer'` → TransferInstruction created (receiver must accept)

---

## 2. AmuletRules_CreateTransferPreapproval — Arg Shape (Dari Dok Splice)

**Template:** `Splice.AmuletRules:AmuletRules`

**Choice:** `AmuletRules_CreateTransferPreapproval`

**Arg Shape (berdasarkan pola Splice):**

```typescript
{
  expectedDso: string,        // DSO party ID (CANTON_DSO_PARTY_ID)
  provider: string,           // Provider party ID (validator/operator)
  receiver: string,           // Receiver party ID (user)
  expiresAt: string,          // ISO timestamp (e.g., 1 year from now)
  context: {                  // Mining round context (dari registry)
    amuletRules: string,      // AmuletRules contract ID
    openMiningRound: string,  // OpenMiningRound contract ID
    // ... other context fields
  },
  inputs: [                   // Provider's Amulet holdings (untuk burn fee)
    { contractId: string, amount: string }
  ]
}
```

**CATATAN PENTING:**
- **Provider pre-pay fee** (burn Amulet) → butuh `inputs` (provider's Amulet holdings).
- **Context** (AmuletRules + OpenMiningRound) → dari registry (sama seperti transfer).
- **expectedDso** → WAJIB, dari `CANTON_DSO_PARTY_ID`.
- **provider** → HARUS = party validator-operator (biar renewal automation jalan).
- **receiver** → party user yang mau aktifkan preapproval.

---

## 3. Query TransferPreapproval yang Sudah Ada (Untuk Referensi)

**TIDAK ADA** TransferPreapproval yang sudah ada di ledger saat ini (user `verify` tidak punya preapproval).

**Alternatif:** Query dari Splice Wallet API (HS256) untuk user yang sudah punya preapproval (e.g., `canquest-fee`).

**Problem:** Splice Wallet API menolak HS256 di Keycloak mode → **TIDAK BISA** query via Splice API.

**Solusi:** Gunakan **format standar** dari dok Splice:
- `expiresAt` → ISO timestamp (e.g., `2025-12-31T23:59:59Z`)
- `provider` → party validator-operator (e.g., `canquest-validator-1::1220...`)

---

## 4. Env Variables

**CANTON_DSO_PARTY_ID:**
- **TIDAK ADA** di `.env.example` (tidak dikonfigurasi).
- **Digunakan di:** `executeTransferFactoryTransfer()` line 482 → `expectedAdmin`.
- **Fallback:** Empty string → **GAGAL** (required for CIP-0056).

**CANTON_VALIDATOR_PARTY_ID:**
- **ADA** di `.env.example` (dikonfigurasi).
- **Digunakan sebagai:** Provider party untuk preapproval.

**Problem:** `CANTON_DSO_PARTY_ID` **TIDAK dikonfigurasi** → butuh tambah ke `.env.example` + `.env`.

---

## 5. Cara Rakit Context + Inputs untuk CreateTransferPreapproval

### 5.1. Context (AmuletRules + OpenMiningRound)

**TIDAK ADA** registry endpoint untuk `AmuletRules_CreateTransferPreapproval`.

**Registry hanya support:**
- `/registry/transfer-instruction/v1/transfer-factory` (untuk transfer)
- `/registry/transfer-instruction/v1/{id}/choice-contexts/{action}` (untuk accept/reject/withdraw)

**Problem:** Kita **TIDAK BISA** call registry untuk get context `AmuletRules_CreateTransferPreapproval`.

**Solusi (2 opsi):**

**Opsi A (Recommended):** Query ACS untuk `AmuletRules` + `OpenMiningRound` contract, rakit context manual.

```typescript
// Query AmuletRules contract (visible to operator)
const amuletRulesContracts = await this.queryActiveContracts(
  '#splice-amulet:Splice.AmuletRules:AmuletRules',
  [operatorPartyId]
);
const amuletRulesCid = amuletRulesContracts[0]?.contractId;

// Query OpenMiningRound contract (visible to operator)
const openMiningRoundContracts = await this.queryActiveContracts(
  '#splice-amulet:Splice.AmuletRules:OpenMiningRound',
  [operatorPartyId]
);
const openMiningRoundCid = openMiningRoundContracts[0]?.contractId;

// Rakit context
const context = {
  amuletRules: amuletRulesCid,
  openMiningRound: openMiningRoundCid,
  // ... other fields (jika ada)
};
```

**Opsi B (Pragmatic):** **SKIP** context (set `context: { values: {} }`). Jika choice menolak, fallback ke Splice Wallet UI.

### 5.2. Inputs (Provider's Amulet Holdings)

**Provider pre-pay fee** → butuh Amulet holdings milik provider.

```typescript
const providerPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
const providerHoldings = await this.queryAmuletHoldings(providerPartyId);
const inputs = providerHoldings.map((h) => ({
  contractId: h.contractId,
  amount: h.amount,
}));
```

**Problem:** Jika provider **TIDAK punya** Amulet holdings → **GAGAL** (cannot fund fee).

**Solusi:** Pastikan validator-operator punya Amulet holdings (top-up via faucet atau transfer).

---

## 6. Operator CanActAs Provider + Receiver

**Operator (LEDGER_API_ADMIN_USER)** harus punya `CanActAs` ke:
- **Provider party** (validator-operator) → untuk exercise choice atas nama provider.
- **Receiver party** (user) → untuk create contract dengan observer user.

**actAs:** `[providerPartyId, receiverPartyId]`

**Problem:** Operator mungkin **TIDAK punya** `CanActAs` ke receiver party (user).

**Solusi (2 opsi):**

**Opsi A (Recommended):** Operator hanya `actAs` provider, receiver jadi **observer** (tidak butuh `CanActAs`).

```typescript
actAs: [providerPartyId]
```

**Opsi B (Fallback):** Grant `CanActAs` ke operator untuk receiver party (via `grantUserRights()`).

---

## 7. Disclosed Contracts

**TransferFactory_Transfer** butuh disclosed contracts dari registry.

**AmuletRules_CreateTransferPreapproval** kemungkinan **JUGA** butuh disclosed contracts (AmuletRules + OpenMiningRound).

**Problem:** **TIDAK ADA** registry endpoint untuk get disclosed contracts `AmuletRules_CreateTransferPreapproval`.

**Solusi (2 opsi):**

**Opsi A (Recommended):** Query ACS untuk `AmuletRules` + `OpenMiningRound`, rakit disclosed contracts manual.

```typescript
const disclosedContracts = [
  { contractId: amuletRulesCid, templateId: '#splice-amulet:Splice.AmuletRules:AmuletRules', createArgument: { ... } },
  { contractId: openMiningRoundCid, templateId: '#splice-amulet:Splice.AmuletRules:OpenMiningRound', createArgument: { ... } },
];
```

**Opsi B (Pragmatic):** **SKIP** disclosed contracts (set `disclosedContracts: []`). Jika choice menolak, fallback ke Splice Wallet UI.

---

## 8. Summary Investigasi

### 8.1. Arg Shape AmuletRules_CreateTransferPreapproval

```typescript
{
  expectedDso: string,        // CANTON_DSO_PARTY_ID (BELUM dikonfigurasi)
  provider: string,           // CANTON_VALIDATOR_PARTY_ID (validator-operator)
  receiver: string,           // User party ID
  expiresAt: string,          // ISO timestamp (e.g., 1 year from now)
  context: {                  // AmuletRules + OpenMiningRound (dari ACS query)
    amuletRules: string,
    openMiningRound: string,
  },
  inputs: [                   // Provider's Amulet holdings (untuk burn fee)
    { contractId: string, amount: string }
  ]
}
```

### 8.2. Cara Rakit Context + Inputs

**Context:**
- Query ACS untuk `AmuletRules` + `OpenMiningRound` contract (visible to operator).
- Rakit context manual: `{ amuletRules: cid, openMiningRound: cid }`.

**Inputs:**
- Query `queryAmuletHoldings(providerPartyId)` untuk get provider's Amulet holdings.
- Map ke `[{ contractId, amount }]`.

**Disclosed Contracts:**
- Query ACS untuk `AmuletRules` + `OpenMiningRound` contract.
- Rakit disclosed contracts manual (jika diperlukan).

### 8.3. Provider Party

**Provider = CANTON_VALIDATOR_PARTY_ID** (validator-operator).

**Alasan:** Provider harus = party validator-operator (biar renewal automation jalan).

### 8.4. Operator CanActAs

**actAs:** `[providerPartyId]` (operator act as provider, receiver jadi observer).

**TIDAK butuh** `CanActAs` ke receiver party (user).

### 8.5. Env Variables yang Dibutuhkan

**CANTON_DSO_PARTY_ID:**
- **BELUM dikonfigurasi** di `.env.example`.
- **WAJIB** untuk `expectedDso` (CIP-0056).
- **Tambah** ke `.env.example` + `.env`.

**CANTON_VALIDATOR_PARTY_ID:**
- **SUDAH dikonfigurasi** di `.env.example`.
- **Digunakan** sebagai provider party.

---

## 9. Rekomendasi Implementasi

### 9.1. Opsi A (Full Implementation)

**Implementasi lengkap:**
1. Query ACS untuk `AmuletRules` + `OpenMiningRound` → rakit context.
2. Query `queryAmuletHoldings(providerPartyId)` → rakit inputs.
3. Exercise `AmuletRules_CreateTransferPreapproval` dengan disclosed contracts.

**Pros:**
- ✅ Full control, tidak depend on Splice Wallet API.
- ✅ Keycloak mode compatible.

**Cons:**
- ⚠️ Complex (butuh query ACS + rakit context/inputs/disclosed contracts).
- ⚠️ Provider harus punya Amulet holdings (untuk burn fee).
- ⚠️ Butuh `CANTON_DSO_PARTY_ID` (belum dikonfigurasi).

### 9.2. Opsi B (Pragmatic — Recommended untuk Chunk 1)

**Implementasi pragmatic:**
1. **SKIP** create via Ledger API untuk Chunk 1.
2. User aktifkan preapproval via **Splice Wallet UI** (manual).
3. Backend hanya support:
   - **Check** preapproval via Ledger API (query ACS) — **SUDAH** di diff sebelumnya.
   - **Cancel** preapproval via Ledger API (exercise `TransferPreapproval_Cancel`) — **SUDAH** di diff sebelumnya.

**Pros:**
- ✅ Simple, tidak butuh rakit context/inputs/disclosed contracts.
- ✅ User tetap bisa aktifkan preapproval (via Splice Wallet UI).
- ✅ Backend check + cancel preapproval **SUDAH JALAN** (Ledger API).

**Cons:**
- ⚠️ User harus aktifkan manual via Splice Wallet UI (tidak otomatis).

### 9.3. Opsi C (Hybrid — Untuk Chunk 2)

**Implementasi hybrid:**
1. **Chunk 1:** Opsi B (pragmatic) — user aktifkan via Splice Wallet UI.
2. **Chunk 2:** Opsi A (full implementation) — backend create via Ledger API.

**Pros:**
- ✅ Chunk 1 cepat (pragmatic), Chunk 2 lengkap (full implementation).
- ✅ User tetap bisa aktifkan preapproval (via Splice Wallet UI) saat Chunk 1.

**Cons:**
- ⚠️ Butuh 2 iterasi (Chunk 1 + Chunk 2).

---

## 10. Next Steps (Manual)

1. **Review** investigasi ini line-by-line.
2. **Konfirmasi** opsi implementasi:
   - **Opsi A** (full implementation) → lanjut rakit context/inputs/disclosed contracts.
   - **Opsi B** (pragmatic) → SKIP create, user pakai Splice Wallet UI.
   - **Opsi C** (hybrid) → Chunk 1 pragmatic, Chunk 2 full implementation.
3. **Jika Opsi A:** Tambah `CANTON_DSO_PARTY_ID` ke `.env.example` + `.env`.
4. **Jika Opsi B/C:** Apply diff sebelumnya (check + cancel preapproval via Ledger API).
5. **Test:** User yang sudah punya preapproval (via Splice Wallet UI) → `/party/preapproval/status` return `active: true`.

**CATATAN:** Investigasi ini **BELUM ada diff/implementation** — menunggu konfirmasi user.
