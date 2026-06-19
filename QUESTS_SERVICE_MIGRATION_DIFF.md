# quests.service.ts — CIP-0056 Fee Collection Migration DIFF

**JANGAN APPLY — REVIEW MANUAL DULU**

## Summary
Migrasi `collectClaimFee()` dari Splice REST (username-based) ke CIP-0056 TransferFactory (partyId-based).

**5 pemanggil** yang harus diupdate:
1. `claimFcfsReward()` — line ~1742
2. `claimDrawCcReward()` — line ~2013
3. `claimInviteReward()` — line ~2255
4. `claimCcAndCodeRaffleReward()` — line ~2479
5. `claimCcAndCodeRaffleReward()` — line ~2600 (second call in same method)

---

## DIFF 1: collectClaimFee() signature + body

**Location:** Line ~2570-2620 (private method definition)

```diff
------- SEARCH
  private async collectClaimFee(params: {
    userId: string;
    username: string;
    questTitle: string;
    feeCc: number;
    feeLabel: string;
    feeTargetPartyId: string;
  }): Promise<string> {
    const feeResult = await this.splice.collectClaimFeeToValidatorParty({
      senderUsername: params.username,
      feeCc: params.feeCc,
      description: `${params.feeLabel} — ${params.questTitle}`,
      validatorPartyId: params.feeTargetPartyId,
    });
=======
  private async collectClaimFee(params: {
    userId: string;
    cantonPartyId: string;  // ← BARU: party user yang bayar fee
    username: string;       // untuk logging saja
    questTitle: string;
    feeCc: number;
    feeLabel: string;
    feeTargetPartyId: string;
  }): Promise<string> {
    const feeResult = await this.splice.collectClaimFeeToValidatorParty({
      senderPartyId: params.cantonPartyId,  // ← BARU: party user (claimer)
      senderUsername: params.username,
      feeCc: params.feeCc,
      description: `${params.feeLabel} — ${params.questTitle}`,
      validatorPartyId: params.feeTargetPartyId,
    });
+++++++ REPLACE
```

---

## DIFF 2: claimFcfsReward() — pemanggil #1

**Location:** Line ~1740-1750

```diff
------- SEARCH
      const feeTxId =
        drawNow?.claimFeeLedgerTxId ??
        (await this.collectClaimFee({
          userId,
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'FCFS claim fee',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
        }));
=======
      const feeTxId =
        drawNow?.claimFeeLedgerTxId ??
        (await this.collectClaimFee({
          userId,
          cantonPartyId,  // ← BARU: party user yang klaim
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'FCFS claim fee',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
        }));
+++++++ REPLACE
```

---

## DIFF 3: claimDrawCcReward() — pemanggil #2

**Location:** Line ~2013-2020

```diff
------- SEARCH
      const feeTxId = await this.collectClaimFee({
        userId,
        username,
        questTitle: quest.title,
        feeCc,
        feeLabel: 'Raffle claim fee',
        feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
      });
=======
      const feeTxId = await this.collectClaimFee({
        userId,
        cantonPartyId,  // ← BARU: party user yang klaim
        username,
        questTitle: quest.title,
        feeCc,
        feeLabel: 'Raffle claim fee',
        feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
      });
+++++++ REPLACE
```

---

## DIFF 4: claimInviteReward() — pemanggil #3

**Location:** Line ~2254-2262

```diff
------- SEARCH
      try {
        feeTxId = await this.collectClaimFee({
          userId,
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'Claim fee',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
        });
=======
      try {
        feeTxId = await this.collectClaimFee({
          userId,
          cantonPartyId,  // ← BARU: party user yang klaim
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'Claim fee',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
        });
+++++++ REPLACE
```

---

## DIFF 5: claimCcAndCodeRaffleReward() — pemanggil #4 (first call)

**Location:** Line ~2479-2486

```diff
------- SEARCH
      const feeTxId = await this.collectClaimFee({
        userId,
        username,
        questTitle: quest.title,
        feeCc,
        feeLabel: 'CC+Code raffle claim fee',
        feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
      });
=======
      const feeTxId = await this.collectClaimFee({
        userId,
        cantonPartyId,  // ← BARU: party user yang klaim
        username,
        questTitle: quest.title,
        feeCc,
        feeLabel: 'CC+Code raffle claim fee',
        feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
      });
+++++++ REPLACE
```

---

## DIFF 6: claimCcAndCodeRaffleReward() — pemanggil #5 (second call, retry path)

**Location:** Line ~2600-2607 (inside catch block for retry)

**CATATAN:** Ini adalah pemanggilan kedua di method yang sama, untuk retry path.

```diff
------- SEARCH
        const retryFeeTxId = await this.collectClaimFee({
          userId,
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'CC+Code raffle claim fee (retry)',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
        });
=======
        const retryFeeTxId = await this.collectClaimFee({
          userId,
          cantonPartyId,  // ← BARU: party user yang klaim
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'CC+Code raffle claim fee (retry)',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
        });
+++++++ REPLACE
```

---

## Verification Checklist

- [x] `collectClaimFee()` signature: tambah `cantonPartyId: string`
- [x] `collectClaimFee()` body: kirim `senderPartyId` ke `collectClaimFeeToValidatorParty()`
- [x] `claimFcfsReward()`: kirim `cantonPartyId` (sudah ada di params)
- [x] `claimDrawCcReward()`: kirim `cantonPartyId` (sudah ada di params)
- [x] `claimInviteReward()`: kirim `cantonPartyId` (sudah ada di params)
- [x] `claimCcAndCodeRaffleReward()`: kirim `cantonPartyId` (sudah ada di params) — 2 calls
- [x] TIDAK ada sisa pemanggil yang kirim `senderUsername` ke `collectPlatformFee()`

---

## Safety Notes

1. **Semua 5 method pemanggil** sudah punya `cantonPartyId` di params mereka — TIDAK perlu ubah signature controller.
2. **Validasi wallet:** Semua pemanggil sudah check `if (!cantonPartyId?.trim())` sebelum panggil `collectClaimFee()`.
3. **Non-blocking:** `collectPlatformFee()` di `splice-validator.service.ts` sudah non-blocking (return `collected=false` on error).
4. **Backward compat:** `username` tetap dikirim untuk logging di `splice-validator.service.ts`.

---

## Build Command

```bash
cd apps/api
npm run build
```

Expected: **NO ERRORS** (TypeScript compilation success).

---

## Next Steps (Manual)

1. Review diff ini line-by-line
2. Apply 6 SEARCH/REPLACE blocks ke `apps/api/src/quests/quests.service.ts`
3. Run `npm run build` di `apps/api`
4. Test klaim terkendali (testnet/dev)
5. Verifikasi fee mendarat di treasury DARI party user (bukan operator)
