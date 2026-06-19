# Reward Step 2 — CIP-0056 Migration Analysis

**JANGAN APPLY — ANALISIS + DIFF SAJA**

## Current State (HS256 Splice REST)

### Method Pengirim Reward

**File:** `apps/api/src/quests/quests.service.ts` (line ~1766-1782)

```typescript
// Step 2: reward wallet (canquest-reward) sends reward → same user party (only after fee is collected).
await this.assertRewardPool(rewardCc);
this.logger.log(
  `Claim fee step 2: ${this.rewardPartyId?.split('::')[0] ?? 'reward'} → ${cantonPartyId.split('::')[0]} (@${username}, ${rewardCc} CC)`,
);
const rewardOfferId = await this.splice.createTransferOffer(
  cantonPartyId,
  rewardCc,
  `FCFS reward — ${quest.title}`,
  undefined,
  this.rewardSenderUsername,  // ← SENDER USERNAME (canquest-reward-user)
);
if (!rewardOfferId) {
  throw new Error('reward offer failed');
}
const rewardAccepted = await this.splice.acceptOfferViaWallet(
  rewardOfferId,
  username,  // ← USER (claimer) accepts
);
if (!rewardAccepted) {
  throw new Error('reward accept failed');
}
```

### Sender Resolution Logic

**File:** `apps/api/src/quests/quests.service.ts` (line 288-304)

```typescript
/** Resolve the Splice username for reward sending (canquest-reward wallet). */
private get rewardSenderUsername(): string {
  return (
    this.config.get<string>('CANTON_REWARD_API_USER')?.trim() ||
    this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER')?.trim() ||
    'administrator'
  );
}

/** Resolve the reward party ID for sending rewards. */
private get rewardPartyId(): string | null {
  return (
    this.config.get<string>('CANTON_REWARD_PARTY_ID')?.trim() ||
    this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ||
    null
  );
}
```

**Env Variables:**
- `CANTON_REWARD_API_USER` → username Splice (e.g., `canquest-reward-user`)
- `CANTON_REWARD_PARTY_ID` → party ID reward wallet (e.g., `canquest-reward-user::12209...442fb`)

### createTransferOffer() — Splice REST (HS256)

**File:** `apps/api/src/canton/splice-validator.service.ts` (line 534-616)

```typescript
async createTransferOffer(
  receiverPartyId: string,
  amountCc: number,
  description = 'CanQuest reward',
  trackingId = randomUUID(),
  senderUsername?: string,  // ← SENDER USERNAME (canquest-reward-user)
): Promise<string | null> {
  if (!this.isConfigured) return null;

  const effectiveSender =
    senderUsername ?? this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER') ?? 'administrator';

  // Resolve sender party ID
  const senderPartyId =
    (effectiveSender !== 'administrator'
      ? await this.getWalletPartyId(effectiveSender)  // ← GET PARTY ID FROM SPLICE API (HS256)
      : null) ??
    this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';

  // ... (TwoStepTransfer body)

  this.logger.log(
    `TransferOffer TwoStepTransfer: ${senderPartyId.split('::')[0]} → ${receiverPartyId.split('::')[0]} ${amountCc} CC`,
  );

  const res = await fetch(url, {
    method: 'POST',
    headers: await this.jsonAuthHeaders(effectiveSender),  // ← HS256 JWT (sub=canquest-reward-user)
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  // ...
}
```

**Problem:**
- `jsonAuthHeaders(effectiveSender)` → HS256 JWT dengan `sub=canquest-reward-user`
- Keycloak mode: Splice API menolak HS256 → **401 Unauthorized**
- Log: `"TransferOffer TwoStepTransfer: canquest-validator-1 → verify"` → sender salah (pakai validator-1, bukan reward-user)

---

## Target State (CIP-0056 Ledger API)

### Reward Sender Party

**KONFIRMASI:**
- Sender reward = `canquest-reward-user::12209...442fb` (dari `CANTON_REWARD_PARTY_ID`)
- Operator punya `CanActAs` party ini (sudah dikonfirmasi berdana 7.6 CC)
- **BUKAN** `canquest-validator-1` (itu untuk fee)

### Migration Strategy

**Ganti:**
```typescript
// OLD (HS256 Splice REST)
const rewardOfferId = await this.splice.createTransferOffer(
  cantonPartyId,
  rewardCc,
  `FCFS reward — ${quest.title}`,
  undefined,
  this.rewardSenderUsername,
);
const rewardAccepted = await this.splice.acceptOfferViaWallet(
  rewardOfferId,
  username,
);
```

**Menjadi:**
```typescript
// NEW (CIP-0056 Ledger API)
const rewardPartyId = this.rewardPartyId;  // canquest-reward-user::12209...442fb
if (!rewardPartyId) {
  throw new Error('CANTON_REWARD_PARTY_ID not configured');
}

const rewardResult = await this.questLedger.executeTransferFactoryTransfer({
  senderPartyId: rewardPartyId,        // ← canquest-reward-user (party reward)
  receiverPartyId: cantonPartyId,      // ← party user (claimer)
  amountCc: rewardCc,
  description: `FCFS reward — ${quest.title}`,
});

if (!rewardResult.ok) {
  throw new Error(rewardResult.error ?? 'reward transfer failed');
}

let rewardTxId: string;
if (rewardResult.transferKind === 'direct') {
  rewardTxId = rewardResult.updateId ?? `reward-${Date.now()}-${userId.slice(0, 8)}`;
  this.logger.log(`Reward ${rewardCc} CC via CIP-0056 direct → ${cantonPartyId.split('::')[0]}`);
} else if (rewardResult.transferKind === 'offer' && rewardResult.transferInstructionCid) {
  const acceptR = await this.questLedger.acceptTransferInstruction(
    rewardResult.transferInstructionCid,
    cantonPartyId,  // ← user accepts
  );
  if (!acceptR.ok) {
    throw new Error('reward accept failed');
  }
  rewardTxId = acceptR.updateId ?? rewardResult.updateId ?? `reward-${Date.now()}-${userId.slice(0, 8)}`;
  this.logger.log(`Reward ${rewardCc} CC via CIP-0056 offer-accept → ${cantonPartyId.split('::')[0]}`);
} else {
  throw new Error('reward transfer failed (unknown kind)');
}

// Use rewardTxId for ledgerTxId (instead of rewardOfferId)
```

---

## DIFF — Migrasi Reward Step 2 ke CIP-0056

**File:** `apps/api/src/quests/quests.service.ts`

### DIFF 1: claimFcfsReward() — Reward Step 2

**Location:** Line ~1761-1782

```diff
------- SEARCH
      // Step 2: reward wallet (canquest-reward) sends reward → same user party (only after fee is collected).
      await this.assertRewardPool(rewardCc);
      this.logger.log(
        `Claim fee step 2: ${this.rewardPartyId?.split('::')[0] ?? 'reward'} → ${cantonPartyId.split('::')[0]} (@${username}, ${rewardCc} CC)`,
      );
      const rewardOfferId = await this.splice.createTransferOffer(
        cantonPartyId,
        rewardCc,
        `FCFS reward — ${quest.title}`,
        undefined,
        this.rewardSenderUsername,
      );
      if (!rewardOfferId) {
        throw new Error('reward offer failed');
      }
      const rewardAccepted = await this.splice.acceptOfferViaWallet(
        rewardOfferId,
        username,
      );
      if (!rewardAccepted) {
        throw new Error('reward accept failed');
      }
=======
      // Step 2: reward wallet (canquest-reward) sends reward → same user party (only after fee is collected).
      await this.assertRewardPool(rewardCc);
      const rewardPartyId = this.rewardPartyId;
      if (!rewardPartyId) {
        throw new Error('CANTON_REWARD_PARTY_ID not configured');
      }
      this.logger.log(
        `Claim fee step 2: ${rewardPartyId.split('::')[0]} → ${cantonPartyId.split('::')[0]} (@${username}, ${rewardCc} CC)`,
      );

      const rewardResult = await this.questLedger.executeTransferFactoryTransfer({
        senderPartyId: rewardPartyId,
        receiverPartyId: cantonPartyId,
        amountCc: rewardCc,
        description: `FCFS reward — ${quest.title}`,
      });

      if (!rewardResult.ok) {
        throw new Error(rewardResult.error ?? 'reward transfer failed');
      }

      let rewardTxId: string;
      if (rewardResult.transferKind === 'direct') {
        rewardTxId = rewardResult.updateId ?? `reward-${Date.now()}-${userId.slice(0, 8)}`;
        this.logger.log(`Reward ${rewardCc} CC via CIP-0056 direct → ${cantonPartyId.split('::')[0]}`);
      } else if (rewardResult.transferKind === 'offer' && rewardResult.transferInstructionCid) {
        const acceptR = await this.questLedger.acceptTransferInstruction(
          rewardResult.transferInstructionCid,
          cantonPartyId,
        );
        if (!acceptR.ok) {
          throw new Error('reward accept failed');
        }
        rewardTxId = acceptR.updateId ?? rewardResult.updateId ?? `reward-${Date.now()}-${userId.slice(0, 8)}`;
        this.logger.log(`Reward ${rewardCc} CC via CIP-0056 offer-accept → ${cantonPartyId.split('::')[0]}`);
      } else {
        throw new Error('reward transfer failed (unknown kind)');
      }
+++++++ REPLACE
```

**Changes:**
- ✅ Ganti `createTransferOffer` + `acceptOfferViaWallet` → `executeTransferFactoryTransfer`
- ✅ Sender = `rewardPartyId` (dari `CANTON_REWARD_PARTY_ID`, bukan validator-1)
- ✅ Receiver = `cantonPartyId` (party user claimer)
- ✅ Direct → selesai; Offer → `acceptTransferInstruction(receiver=user)`
- ✅ `rewardTxId` = `updateId` (bukan `rewardOfferId`)

### DIFF 2: claimFcfsReward() — Update ledgerTxId reference

**Location:** Line ~1787-1810

```diff
------- SEARCH
      // canquest-v11: Atomic DAML choice — fee + reward + audit trail dalam SATU transaksi.
      // Jika salah satu gagal, Canton rollback seluruhnya. Tidak ada partial commit.
      if (claimSessionId) {
        const atomicResult = await this.questLedger.atomicFeeAndReward({
          claimContractId: claimSessionId,
          feeTxId,
          rewardTxId: rewardOfferId,
          txLogId: `fcfstx-${reservedDrawId.slice(0, 12)}`,
          amountMicroCc: Math.round(rewardCc * 1_000_000),
          description: `FCFS reward — ${quest.title}`,
          referenceId: questId,
        });
        if (!atomicResult.ok) {
          this.logger.warn(
            `AtomicFeeAndReward FCFS failed (non-blocking): ${atomicResult.errors.join(' | ')}`,
          );
        }
      }

      await this.users.recordTransaction({
        userId,
        amountCc: rewardCc,
        type: 'QUEST_REWARD',
        description: `Received ${rewardCc} CC reward`,
        referenceId: questId,
        counterparty: validatorPartyId.split('::')[0],
        ledgerTxId: rewardOfferId,
      });
=======
      // canquest-v11: Atomic DAML choice — fee + reward + audit trail dalam SATU transaksi.
      // Jika salah satu gagal, Canton rollback seluruhnya. Tidak ada partial commit.
      if (claimSessionId) {
        const atomicResult = await this.questLedger.atomicFeeAndReward({
          claimContractId: claimSessionId,
          feeTxId,
          rewardTxId: rewardTxId,
          txLogId: `fcfstx-${reservedDrawId.slice(0, 12)}`,
          amountMicroCc: Math.round(rewardCc * 1_000_000),
          description: `FCFS reward — ${quest.title}`,
          referenceId: questId,
        });
        if (!atomicResult.ok) {
          this.logger.warn(
            `AtomicFeeAndReward FCFS failed (non-blocking): ${atomicResult.errors.join(' | ')}`,
          );
        }
      }

      await this.users.recordTransaction({
        userId,
        amountCc: rewardCc,
        type: 'QUEST_REWARD',
        description: `Received ${rewardCc} CC reward`,
        referenceId: questId,
        counterparty: rewardPartyId.split('::')[0],
        ledgerTxId: rewardTxId,
      });
+++++++ REPLACE
```

**Changes:**
- ✅ `rewardTxId: rewardOfferId` → `rewardTxId: rewardTxId`
- ✅ `counterparty: validatorPartyId` → `counterparty: rewardPartyId` (canquest-reward-user)
- ✅ `ledgerTxId: rewardOfferId` → `ledgerTxId: rewardTxId`

### DIFF 3: claimFcfsReward() — Update WinnerDraw ledgerTxId

**Location:** Line ~1823-1832

```diff
------- SEARCH
      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.$transaction([
        this.prisma.winnerDraw.update({
          where: { id: reservedDrawId! },
          data: {
            distributed: true,
            ccAmount: rewardCc,
            claimFeeLedgerTxId: feeTxId,
            ledgerTxId: rewardOfferId,
            ...(claimSessionId ? { claimSessionContractId: claimSessionId } : {}),
          },
        }),
=======
      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.$transaction([
        this.prisma.winnerDraw.update({
          where: { id: reservedDrawId! },
          data: {
            distributed: true,
            ccAmount: rewardCc,
            claimFeeLedgerTxId: feeTxId,
            ledgerTxId: rewardTxId,
            ...(claimSessionId ? { claimSessionContractId: claimSessionId } : {}),
          },
        }),
+++++++ REPLACE
```

**Changes:**
- ✅ `ledgerTxId: rewardOfferId` → `ledgerTxId: rewardTxId`

### DIFF 4: claimFcfsReward() — Update syncCampaignLedgerAfterPayout

**Location:** Line ~1845-1852

```diff
------- SEARCH
      if (cantonPartyId) {
        void this.syncCampaignLedgerAfterPayout({
          userId,
          questId,
          userPartyId: cantonPartyId,
          rewardCc,
          payoutTxId: rewardOfferId,
        }).catch((err) =>
          this.logger.warn(`FCFS ledger sync failed: ${String(err)}`),
        );
      }
=======
      if (cantonPartyId) {
        void this.syncCampaignLedgerAfterPayout({
          userId,
          questId,
          userPartyId: cantonPartyId,
          rewardCc,
          payoutTxId: rewardTxId,
        }).catch((err) =>
          this.logger.warn(`FCFS ledger sync failed: ${String(err)}`),
        );
      }
+++++++ REPLACE
```

**Changes:**
- ✅ `payoutTxId: rewardOfferId` → `payoutTxId: rewardTxId`

---

## Verification Checklist

- [x] Sender reward = `CANTON_REWARD_PARTY_ID` (canquest-reward-user::12209...442fb)
- [x] Receiver = `cantonPartyId` (party user claimer)
- [x] Direct transfer → selesai
- [x] Offer transfer → `acceptTransferInstruction(receiver=user)`
- [x] `rewardTxId` digunakan di semua tempat (bukan `rewardOfferId`)
- [x] `counterparty` = `rewardPartyId` (bukan `validatorPartyId`)
- [x] TIDAK sentuh step 1 (fee) yang sudah jalan
- [x] Buang `createTransferOffer` + `acceptOfferViaWallet` (HS256)

---

## Next Steps (Manual)

1. **Review diff** — 4 SEARCH/REPLACE blocks untuk `claimFcfsReward()`
2. **Apply diff** ke `apps/api/src/quests/quests.service.ts`
3. **Repeat** untuk method lain:
   - `claimDrawCcReward()` (line ~2016-2100)
   - `claimCcAndCodeRaffleReward()` (line ~2484-2600)
4. **Build:** `cd apps/api && npm run build`
5. **Test** klaim terkendali:
   - Log: `"Reward X CC via CIP-0056 direct → user"` (bukan `"TransferOffer TwoStepTransfer"`)
   - Saldo `canquest-reward-user` berkurang (bukan operator)
   - User terima reward
   - **TIDAK ada** `401` / `HS256` di log

---

## Summary

**Current (HS256):**
- `createTransferOffer(receiver, amount, desc, trackingId, senderUsername)`
- `acceptOfferViaWallet(offerId, username)`
- Auth: HS256 JWT (`sub=canquest-reward-user`)
- Sender resolve: `getWalletPartyId(senderUsername)` → Splice API (HS256)

**Target (CIP-0056):**
- `executeTransferFactoryTransfer({ senderPartyId, receiverPartyId, amountCc, description })`
- `acceptTransferInstruction(transferInstructionCid, receiverPartyId)` (jika offer)
- Auth: Keycloak client_credentials (operator)
- Sender: `CANTON_REWARD_PARTY_ID` (canquest-reward-user::12209...442fb)

**Impact:**
- ✅ Fee (step 1) sudah CIP-0056 — TIDAK diubah
- ✅ Reward (step 2) migrasi ke CIP-0056 — buang HS256
- ✅ Sender reward = canquest-reward-user (bukan validator-1)
- ✅ Keycloak mode compatible
