# Pertanyaan ke Canton AI — Atomic Fee to canquest-fee

> Confirmasi pattern atomic fee+reward di DAML Settle choice.

---

## PROMPT (copy dari sini)

My DAML v22 has a Settle choice that does atomic fee + reward via nested
TransferFactory_Transfer exercises. I want to confirm the atomicity semantics
for the FEE leg specifically.

USE CASE: Quest reward claim. User pays a claim fee (CC token) to a treasury
party (canquest-fee), and receives a reward (CC token) from a reward wallet
(canquest-reward-user). Both transfers MUST be atomic — if either fails,
neither happens.

CURRENT DAML (verified compiles + builds in SDK 3.4.11):

```haskell
choice Settle : ContractId QuestClaimReceipt
  with
    -- FEE: user → canquest-fee (treasury)
    feeFactoryCid    : ContractId TransferFactory
    feeTransfer      : Transfer       -- {sender=user, receiver=canquest-fee, amount=3.0, ...}
    feeExtraArgs     : ExtraArgs
    -- REWARD: canquest-reward-user → user
    rewardFactoryCid : ContractId TransferFactory
    rewardTransfer   : Transfer       -- {sender=rewardParty, receiver=user, amount=10.0, ...}
    rewardExtraArgs  : ExtraArgs
    featuredAppRightCid : Optional (ContractId FeaturedAppRight)
    appProvider      : Party
    settledAt        : Text
  controller admin   -- operator party
  do
    assertMsg "Claim harus PRE_SETTLE!" (status == "PRE_SETTLE")
    assertMsg "Fee atau reward harus > 0!" (claimFeeCc > 0.0 || rewardCc > 0.0)

    -- LEG 1: FEE transfer (user → treasury)
    -- Controller of TransferFactory_Transfer = transfer.sender = user
    _feeResult <- exercise feeFactoryCid TransferFactory_Transfer with
      expectedAdmin = feeTransfer.instrumentId.admin
      transfer      = feeTransfer
      extraArgs     = feeExtraArgs

    -- LEG 2: REWARD transfer (rewardParty → user)
    -- Controller = rewardTransfer.sender = rewardParty
    _rewardResult <- exercise rewardFactoryCid TransferFactory_Transfer with
      expectedAdmin = rewardTransfer.instrumentId.admin
      transfer      = rewardTransfer
      extraArgs     = rewardExtraArgs

    -- LEG 3 (optional): FAR activity marker
    forA_ featuredAppRightCid $ \farCid ->
      exercise farCid FeaturedAppRight_CreateActivityMarker with
        beneficiaries = [ AppRewardBeneficiary { beneficiary = appProvider, weight = 1.0 } ]
        weight = None

    -- Settle receipt state
    create this with
      feePaid    = True
      rewardSent = True
      status     = "SETTLED"
```

At command submission, backend sets:
- actAs: [admin-operator, user-party, canquest-reward-user] (+ appProvider if FAR)
- The user party is observer-only in DAML but is co-signing at command level.

QUESTIONS:

1. ATOMICITY GUARANTEE: Confirm that fee leg + reward leg are truly atomic.
   If fee TransferFactory_Transfer fails (e.g. user has insufficient holding,
   or feeTransfer.inputHoldingCids wrong), does the reward leg also rollback?
   Does the Settle choice itself rollback (no SETTLED receipt created)?
   Is this guaranteed by the single transaction tree?

2. ORDERING WITHIN ATOMIC: The fee leg runs first. If it succeeds but reward
   leg fails, does fee leg also rollback (so user keeps their fee tokens)?
   Or does fee leg already mutate holdings before reward leg is attempted?
   In DAML transaction semantics, are all creates/archives computed first
   then committed together, or are they sequenced mid-transaction?

3. PARTIAL FAILURE: What happens if fee leg's inputHoldingCids is empty
   (user has no Amulet to pay fee)? Does DAML reject the whole transaction
   cleanly, or could the user be charged a partial amount somehow?

4. AUTHORIZATION: My actAs covers [admin, user, rewardParty]. The fee leg
   controller = user (transfer.sender). The reward leg controller =
   rewardParty. Both are in actAs. Is there any additional authorization
   needed for the operator to drive this multi-leg atomic settlement
   where user and rewardParty are different signers on different legs?

5. IDEMPOTENCY: If backend retries Settle (commandId dedup), will Canton
   detect the duplicate and skip? Or could fee be charged twice if
   commandId same but command reaches ledger multiple times during
   network partition?

6. REAL-WORLD RISK: Is there any production edge case where atomicity
   could silently break — e.g. contract disclosure mismatch between
   fee factory and reward factory, or synchronizer topology issues?

Please confirm the atomicity is solid for fee→treasury + reward→user
in single Settle transaction, or flag any concerns.

##sampai sini
