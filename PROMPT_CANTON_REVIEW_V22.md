# Pertanyaan REVIEW ke Canton AI — DAML v22

> Saya sudah tulis DAML v22 berdasarkan jawaban signature sebelumnya.
> Tolong review untuk idiomatik, authorization, dan hal yang bisa break.

---

## PROMPT (copy dari sini)

I've written my DAML v22 package (canquest-v22, SDK 3.4.11). It's based on the
signatures you gave me earlier (TransferFactory_Transfer, ExtraArgs, FeaturedAppRight).
Please review for correctness, idiom, and anything that will break.

CONTEXT:
- Custodial operator pattern. operator = signatory + controller semua choice.
- Atomic Settle: nested exercise 2 TransferFactory_Transfer + optional FAR marker.
- actAs = [operator, userAddress, rewardParty] (+ appProvider bila FAR on).
- Tx ID via post-settle RecordTxId (can't get from inside choice).

FULL DAML v22 (Main.daml) — please review:

```haskell
module Main where

import Daml.Script hiding (forA_)
import DA.Foldable (forA_)
import qualified DA.Map as Map
import qualified DA.Set as Set

import Splice.Api.Token.TransferInstructionV1
  ( TransferFactory, TransferFactory_Transfer, TransferInstructionResult
  , Transfer, ExtraArgs )
import Splice.Api.Token.HoldingV1 (Holding, InstrumentId)
import Splice.Api.Token.MetadataV1 (Metadata, ChoiceContext)
import Splice.Api.FeaturedAppRightV2
  ( FeaturedAppRight, FeaturedAppRight_CreateActivityMarker, AppRewardBeneficiary )

data CampaignStatus = DRAFT | ACTIVE | PAUSED | ENDED | CLOSED deriving (Eq, Show)

template WalletRegistration
  with
    operator : Party; userAddress : Party; username : Text
    partyId : Text; inviteCode : Text; registeredAt : Text
  where
    signatory operator
    observer userAddress
    key (operator, userAddress) : (Party, Party)
    maintainer key._1

template QuestCampaign
  with
    operator : Party; campaignId : Text; title : Text; questKind : Text
    rewardToken : Text; rewardAmount : Decimal; claimFeeAmount : Decimal
    maxWinners : Int; currentClaims : Int; status : CampaignStatus; createdAt : Text
  where
    signatory operator
    key (operator, campaignId) : (Party, Text)
    maintainer key._1

    nonconsuming choice ClaimSlot : (ContractId QuestCampaign, ContractId QuestClaimReceipt)
      with user : Party; claimId : Text; rewardCode : Text; claimedAt : Text
      controller operator
      do
        assertMsg "Campaign harus ACTIVE!" (status == ACTIVE)
        assertMsg "questKind harus FCFS!" (questKind == "CC_FCFS" || questKind == "CODE_FCFS")
        assertMsg "Kuota FCFS sudah habis!" (maxWinners == 0 || currentClaims < maxWinners)
        archive self
        newCampaignCid <- create this with { currentClaims = currentClaims + 1 }
        newClaimCid <- create QuestClaimReceipt with
          { operator = operator; campaignId = campaignId; userAddress = user
          ; claimId = claimId; claimKind = questKind; rewardToken = rewardToken
          ; rewardAmount = rewardAmount; rewardCode = rewardCode
          ; claimFeeAmount = claimFeeAmount; feePaid = False; feeTxId = None
          ; rewardSent = False; rewardTxId = None; status = PRE_SETTLE; claimedAt = claimedAt }
        pure (newCampaignCid, newClaimCid)

    -- DrawWinner: sama struktur, guard questKind RAFFLE/WAITLIST

    nonconsuming choice Activate : ContractId QuestCampaign
      with updatedAt : Text
      controller operator
      do assertMsg "..." (status == DRAFT || status == PAUSED)
         archive self; create this with { status = ACTIVE }

    -- Pause, EndCampaign: serupa

    consuming choice Close : ()
      with closedAt : Text
      controller operator
      do assertMsg "..." (status == ACTIVE || status == ENDED); return ()

data ClaimStatus = PRE_SETTLE | SETTLED | REVEALED deriving (Eq, Show)

template QuestClaimReceipt
  with
    operator : Party; campaignId : Text; userAddress : Party; claimId : Text
    claimKind : Text; rewardToken : Text; rewardAmount : Decimal; rewardCode : Text
    claimFeeAmount : Decimal; feePaid : Bool; feeTxId : Optional Text
    rewardSent : Bool; rewardTxId : Optional Text; status : ClaimStatus; claimedAt : Text
  where
    signatory operator
    observer userAddress
    key (operator, campaignId, userAddress) : (Party, Text, Party)
    maintainer key._1

    nonconsuming choice Settle : ContractId QuestClaimReceipt
      with
        feeFactoryCid : ContractId TransferFactory; feeTransfer : Transfer; feeExtraArgs : ExtraArgs
        rewardFactoryCid : ContractId TransferFactory; rewardTransfer : Transfer; rewardExtraArgs : ExtraArgs
        featuredAppRightCid : Optional (ContractId FeaturedAppRight); appProvider : Party; settledAt : Text
      controller operator
      do
        assertMsg "Claim harus PRE_SETTLE!" (status == PRE_SETTLE)
        assertMsg "Fee atau reward harus > 0!" (claimFeeAmount > 0.0 || rewardAmount > 0.0)
        _feeResult <- exercise feeFactoryCid TransferFactory_Transfer with
          { expectedAdmin = feeTransfer.instrumentId.admin; transfer = feeTransfer; extraArgs = feeExtraArgs }
        _rewardResult <- exercise rewardFactoryCid TransferFactory_Transfer with
          { expectedAdmin = rewardTransfer.instrumentId.admin; transfer = rewardTransfer; extraArgs = rewardExtraArgs }
        forA_ featuredAppRightCid $ \farCid ->
          exercise farCid FeaturedAppRight_CreateActivityMarker with
            { beneficiaries = [AppRewardBeneficiary with { beneficiary = appProvider }] }
        archive self
        create this with { feePaid = True, rewardSent = True, status = SETTLED }

    nonconsuming choice RecordTxId : ContractId QuestClaimReceipt
      with feeTxId : Text; rewardTxId : Text
      controller operator
      do assertMsg "..." (status == SETTLED)
         archive self
         create this with { feeTxId = Some feeTxId, rewardTxId = Some rewardTxId }

    nonconsuming choice RevealCode : ContractId QuestClaimReceipt
      with code : Text; revealedAt : Text
      controller operator
      do assertMsg "..." (feePaid || claimFeeAmount == 0.0)
         archive self
         create this with { rewardCode = code, status = REVEALED }

    consuming choice Expire : ()
      with expiredAt : Text
      controller operator
      do assertMsg "..." (status == PRE_SETTLE); return ()
```

QUESTIONS:

1. CONTRACT KEY MAINTENANCE:
   In ClaimSlot/DrawWinner/Activate/Settle/RevealCode I do "archive self; create this with ..."
   for state transitions. The contract has key (operator, campaignId, userAddress).
   When I archive self then immediately create this with new fields — does the key
   uniqueness guarantee still hold? Is there a race where 2 transactions see the
   same key? Should I use `nonconsuming` (which I did) + archive+create, or is
   there a better idiom?

2. NESTED EXERCISE AUTHORIZATION:
   In Settle, I exercise feeTransfer (controller=feeTransfer.sender=user) and
   rewardTransfer (controller=rewardTransfer.sender=rewardParty). At command
   submission, actAs=[operator, user, rewardParty]. The DAML choice controller
   is operator. Will the nested exercises inherit authorization from the command-
   level actAs, or do I need explicit authorization in the DAML choice body?

3. FAR v2 AppRewardBeneficiary:
   I wrote `AppRewardBeneficiary with { beneficiary = appProvider }` but earlier
   you mentioned v2 has `weight : Optional Decimal`. Is the field `weight` required
   in v2, or optional? What's the exact record shape? Should I pass weight = Some 1.0?

4. TransferFactory_Transfer ARGUMENT SHAPE:
   I access `feeTransfer.instrumentId.admin` to set expectedAdmin. Is `instrumentId`
   a field directly on Transfer, or is it nested differently? Earlier answer said
   InstrumentId is a separate record {admin, id} — confirm Transfer.instrumentId
   is the right accessor path.

5. archive self BEFORE create this with — ORDER:
   In ClaimSlot I do "archive self; create this with counter+1". But "self" is the
   current QuestCampaign being exercised. Is it safe to archive self then create a
   NEW contract from "this" (the archived payload)? Or should I capture fields first?

6. MISSING: should QuestCampaign.Close also create some terminal marker, or is
   archive (consuming) sufficient for "campaign closed" finality?

7. DAML COMPILATION CHECK:
   Will this compile against SDK 3.4.11 with the data-dependencies I listed
   (splice-api-token-transfer-instruction-v1, holding-v1, metadata-v1, featured-app-v2)?
   Any imports I'm missing (e.g. do I need `TransferInstructionResult_Output` for
   pattern matching the result)?

Please give specific corrections line-by-line where needed.
