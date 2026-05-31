# DAML Contracts Documentation

## Overview

This document describes the DAML contracts implemented for the CanQuest platform following Canton Network Module 3 (M3) contract templates and design patterns.

**Documentation Reference:** https://docs.canton.network/appdev/modules/m3-contract-templates

## Contract Architecture

The contracts are organized into the following modules:

```
packages/daml/daml/CanQuest/
├── Quest/                    # Existing quest-related contracts
│   ├── Completion.daml       # Quest completion certificates
│   ├── Participation.daml    # Quest participation audit trail
│   ├── Reward.daml           # Quest reward entitlements
│   └── Task.daml             # Per-task submission audit
├── Reward/
│   └── ClaimSession.daml     # FCFS/invite claim state machine
├── Wallet/                   # NEW: Wallet and transfer contracts
│   ├── PartyRegistration.daml # Party ID creation with invite codes
│   └── CcTransfer.daml       # CC token transfers with fees
└── Earn/                     # NEW: Earn task contracts
    ├── EarnTask.daml         # Campaign and task completion
    └── ClaimFlow.daml        # Claim flow state machines
```

## Module 1: Wallet Contracts

### PartyRegistration

**File:** [`packages/daml/daml/CanQuest/Wallet/PartyRegistration.daml`](../packages/daml/daml/CanQuest/Wallet/PartyRegistration.daml)

Records that a user created their Canton wallet using an invite code.

**Fields:**
- `operator`: Party (signatory) - Platform operator
- `user`: Party (observer) - The user who created the wallet
- `username`: Text - Splice wallet username
- `partyId`: Text - Canton Party ID
- `inviteCode`: Text - Invite code used for wallet creation
- `registeredAt`: Text - ISO timestamp
- `spliceOnboarded`: Bool - Whether registered in Splice
- `preapprovalActive`: Bool - Whether TransferPreapproval is active

**Choices:**
- `PartyRegistration_Archive`: Archive the registration
- `PartyRegistration_UpdatePreapproval`: Update preapproval status

### WalletInviteCode

**File:** [`packages/daml/daml/CanQuest/Wallet/PartyRegistration.daml`](../packages/daml/daml/CanQuest/Wallet/PartyRegistration.daml)

Tracks available invite codes issued by admin for wallet creation.

**Fields:**
- `operator`: Party (signatory)
- `code`: Text - The invite code
- `note`: Optional Text - Admin note
- `createdAt`: Text
- `redeemedBy`: Optional Party
- `redeemedAt`: Optional Text
- `reservedBy`: Optional Party - Temporary hold during wallet creation
- `reservedAt`: Optional Text

**Choices:**
- `WalletInviteCode_Reserve`: Reserve code for a user
- `WalletInviteCode_ReleaseReservation`: Release reservation
- `WalletInviteCode_Redeem`: Mark as redeemed
- `WalletInviteCode_Archive`: Archive the code

### CcTransferRecord

**File:** [`packages/daml/daml/CanQuest/Wallet/CcTransfer.daml`](../packages/daml/daml/CanQuest/Wallet/CcTransfer.daml)

Records a CC transfer between parties with platform fee.

**Fields:**
- `operator`: Party (signatory)
- `sender`: Party (observer)
- `recipient`: Party (observer)
- `amountCc`: Decimal - Transfer amount
- `feeCc`: Decimal - Platform fee
- `totalDeductedCc`: Decimal - Total deducted from sender
- `memo`: Optional Text
- `transferTxId`: Text - Canton ledger transaction ID
- `feeTxId`: Optional Text - Fee transaction ID
- `transferredAt`: Text
- `transferKind`: Text - "USER_TO_USER", "REWARD", "CLAIM_FEE"

**Choices:**
- `CcTransferRecord_Archive`: Archive the record

### PlatformFeeConfig

**File:** [`packages/daml/daml/CanQuest/Wallet/CcTransfer.daml`](../packages/daml/daml/CanQuest/Wallet/CcTransfer.daml)

Platform fee configuration contract.

**Fields:**
- `operator`: Party (signatory)
- `feeCc`: Decimal - Current fee amount
- `feeRecipient`: Party - Treasury/validator party
- `updatedAt`: Text
- `version`: Int

**Choices:**
- `PlatformFeeConfig_Update`: Update fee settings
- `PlatformFeeConfig_Archive`: Archive old config

## Module 2: Earn Task Contracts

### EarnCampaign

**File:** [`packages/daml/daml/CanQuest/Earn/EarnTask.daml`](../packages/daml/daml/CanQuest/Earn/EarnTask.daml)

Earn campaign configuration contract.

**Fields:**
- `operator`: Party (signatory)
- `campaignId`: Text
- `title`: Text
- `taskType`: Text - "CC_FCFS", "CC_RAFFLE", "CODE_FCFS", "CODE_RAFFLE"
- `rewardCc`: Decimal
- `maxWinners`: Optional Int
- `claimFeeCc`: Decimal
- `startsAt`: Optional Text
- `endsAt`: Optional Text
- `createdAt`: Text
- `status`: Text - "ACTIVE", "ENDED", "PAUSED"

**Choices:**
- `EarnCampaign_SetStatus`: Update campaign status
- `EarnCampaign_UpdateFee`: Update claim fee
- `EarnCampaign_Archive`: Archive the campaign

### EarnTaskCompletion

**File:** [`packages/daml/daml/CanQuest/Earn/EarnTask.daml`](../packages/daml/daml/CanQuest/Earn/EarnTask.daml)

Task completion record for earn campaigns.

**Fields:**
- `operator`: Party (signatory)
- `user`: Party (observer)
- `campaignId`: Text
- `taskIds`: [Text]
- `proofs`: [Text]
- `completedAt`: Text
- `verified`: Bool

**Choices:**
- `EarnTaskCompletion_Verify`: Mark tasks as verified
- `EarnTaskCompletion_Archive`: Archive the record

### FcfsSlotReservation

**File:** [`packages/daml/daml/CanQuest/Earn/EarnTask.daml`](../packages/daml/daml/CanQuest/Earn/EarnTask.daml)

FCFS claim slot reservation to prevent double-claiming.

**Fields:**
- `operator`: Party (signatory)
- `user`: Party (observer)
- `campaignId`: Text
- `slotIndex`: Int
- `reservedAt`: Text
- `expiresAt`: Text
- `status`: Text - "RESERVED", "CLAIMED", "EXPIRED"

**Choices:**
- `FcfsSlotReservation_Claim`: Mark slot as claimed
- `FcfsSlotReservation_Expire`: Release expired reservation
- `FcfsSlotReservation_Archive`: Archive the reservation

### RaffleWinner

**File:** [`packages/daml/daml/CanQuest/Earn/EarnTask.daml`](../packages/daml/daml/CanQuest/Earn/EarnTask.daml)

Raffle winner record created by admin after drawing winners.

**Fields:**
- `operator`: Party (signatory)
- `user`: Party (observer)
- `campaignId`: Text
- `drawnAt`: Text
- `rewardCc`: Decimal
- `inviteCode`: Optional Text - For Code Raffle
- `status`: Text - "DRAWN", "CLAIMED", "FORFEITED"

**Choices:**
- `RaffleWinner_Claim`: Mark winner as claimed
- `RaffleWinner_Forfeit`: Mark winner as forfeited
- `RaffleWinner_Archive`: Archive the record

## Module 3: Claim Flow Contracts

### EarnClaimSession

**File:** [`packages/daml/daml/CanQuest/Earn/ClaimFlow.daml`](../packages/daml/daml/CanQuest/Earn/ClaimFlow.daml)

Claim session for earn task rewards with state machine.

**Fields:**
- `operator`: Party (signatory)
- `user`: Party (observer)
- `campaignId`: Text
- `claimKind`: Text - "CC_FCFS", "CC_RAFFLE", "CODE_FCFS", "CODE_RAFFLE"
- `feeCc`: Decimal
- `rewardCc`: Decimal
- `rewardCode`: Optional Text - For code rewards
- `createdAt`: Text
- `feePaidAt`: Optional Text
- `feeTxId`: Optional Text
- `rewardSentAt`: Optional Text
- `rewardTxId`: Optional Text
- `status`: Text - "INIT", "FEE_PAID", "REWARD_SENT", "COMPLETED", "CANCELLED"

**State Machine:**
```
INIT → FEE_PAID → REWARD_SENT → COMPLETED
  ↓
CANCELLED
```

**Choices:**
- `EarnClaimSession_MarkFeePaid`: Mark fee as paid
- `EarnClaimSession_MarkRewardSent`: Mark reward as sent
- `EarnClaimSession_Complete`: Mark claim as completed
- `EarnClaimSession_Cancel`: Cancel the claim session
- `EarnClaimSession_Archive`: Archive the session

### CodeRewardPool

**File:** [`packages/daml/daml/CanQuest/Earn/ClaimFlow.daml`](../packages/daml/daml/CanQuest/Earn/ClaimFlow.daml)

Code reward pool for Code FCFS and Code Raffle campaigns.

**Fields:**
- `operator`: Party (signatory)
- `campaignId`: Text
- `codes`: [Text] - Available codes
- `assignedCodes`: [(Text, Party, Text)] - (code, user, assignedAt)
- `createdAt`: Text

**Choices:**
- `CodeRewardPool_AddCodes`: Add codes to the pool
- `CodeRewardPool_AssignCode`: Assign a code to a user
- `CodeRewardPool_Archive`: Archive the pool

### CodeRewardEntitlement

**File:** [`packages/daml/daml/CanQuest/Earn/ClaimFlow.daml`](../packages/daml/daml/CanQuest/Earn/ClaimFlow.daml)

Code reward entitlement created when user claims a code.

**Fields:**
- `operator`: Party (signatory)
- `user`: Party (observer)
- `campaignId`: Text
- `code`: Text
- `claimedAt`: Text
- `feeTxId`: Text
- `claimKind`: Text - "CODE_FCFS" or "CODE_RAFFLE"

**Choices:**
- `CodeRewardEntitlement_Archive`: Archive the entitlement

### CcRewardEntitlement

**File:** [`packages/daml/daml/CanQuest/Earn/ClaimFlow.daml`](../packages/daml/daml/CanQuest/Earn/ClaimFlow.daml)

CC reward entitlement with claim fee tracking.

**Fields:**
- `operator`: Party (signatory)
- `user`: Party (observer)
- `campaignId`: Text
- `rewardCc`: Decimal
- `feeCc`: Decimal
- `claimedAt`: Optional Text
- `feeTxId`: Optional Text
- `rewardTxId`: Optional Text
- `claimKind`: Text - "CC_FCFS" or "CC_RAFFLE"
- `status`: Text - "PENDING", "FEE_PAID", "REWARDED"

**Choices:**
- `CcRewardEntitlement_MarkFeePaid`: Mark fee as paid
- `CcRewardEntitlement_MarkRewarded`: Mark reward as sent
- `CcRewardEntitlement_Archive`: Archive the entitlement

## Earn Task Types

The platform supports 4 earn task types:

### 1. CC FCFS (First-Come-First-Served)

**Flow:**
1. User completes social media tasks
2. User claims reward (pays 3 CC fee)
3. User receives CC reward immediately

**Contracts Used:**
- `EarnCampaign` (taskType: "CC_FCFS")
- `EarnTaskCompletion`
- `FcfsSlotReservation`
- `EarnClaimSession` (claimKind: "CC_FCFS")
- `CcRewardEntitlement`

### 2. CC Raffle

**Flow:**
1. User completes social media tasks
2. Admin draws winners randomly
3. Winners pay 3 CC fee
4. Winners receive CC reward

**Contracts Used:**
- `EarnCampaign` (taskType: "CC_RAFFLE")
- `EarnTaskCompletion`
- `RaffleWinner`
- `EarnClaimSession` (claimKind: "CC_RAFFLE")
- `CcRewardEntitlement`

### 3. Code FCFS

**Flow:**
1. User completes social media tasks
2. User claims reward (pays 3 CC fee)
3. User receives invite code immediately

**Contracts Used:**
- `EarnCampaign` (taskType: "CODE_FCFS")
- `EarnTaskCompletion`
- `FcfsSlotReservation`
- `CodeRewardPool`
- `EarnClaimSession` (claimKind: "CODE_FCFS")
- `CodeRewardEntitlement`

### 4. Code Raffle

**Flow:**
1. User completes social media tasks
2. Admin draws winners randomly
3. Winners pay 3 CC fee
4. Winners receive invite code

**Contracts Used:**
- `EarnCampaign` (taskType: "CODE_RAFFLE")
- `EarnTaskCompletion`
- `RaffleWinner`
- `CodeRewardPool`
- `EarnClaimSession` (claimKind: "CODE_RAFFLE")
- `CodeRewardEntitlement`

## API Integration

The [`QuestLedgerService`](../apps/api/src/canton/quest-ledger.service.ts) provides methods to interact with these contracts:

### Wallet Methods

- `recordPartyRegistration()`: Record wallet creation with invite code
- `recordCcTransfer()`: Record CC transfer with platform fee

### Earn Methods

- `createEarnCampaign()`: Create earn campaign on ledger
- `recordEarnTaskCompletion()`: Record task completion
- `createFcfsSlotReservation()`: Reserve FCFS slot
- `createRaffleWinner()`: Record raffle winner
- `createEarnClaimSession()`: Create claim session
- `markEarnClaimFeePaid()`: Mark fee as paid
- `markEarnClaimRewardSent()`: Mark reward as sent
- `createCodeRewardPool()`: Create code pool
- `createCodeRewardEntitlement()`: Record code entitlement
- `createCcRewardEntitlement()`: Record CC entitlement

## Canton M3 Design Patterns

All contracts follow Canton Module 3 design patterns:

1. **Authorization Pattern**: Operator signs (signatory), user observes
2. **State Machine Pattern**: Explicit status transitions with assertions
3. **Audit Trail Pattern**: Immutable records of all actions
4. **Idempotency**: Contract keys prevent duplicate operations

## Building and Deploying

```bash
cd packages/daml
daml build
daml codegen js --output-directory=daml-js .daml/dist/canquest-v2-0.1.0.dar
```

## Environment Configuration

Set these environment variables in `apps/api/.env`:

```env
# Canton DAML Configuration
CANTON_DAML_PACKAGE_NAME=canquest-v2
CANTON_OPERATOR_PARTY_ID=your-operator-party-id
QUEST_LEDGER_ENABLED=true
CLAIM_SESSION_LEDGER_ENABLED=true

# Platform Fee (default 3 CC)
TRANSACTION_FEE_CC=3
```

## References

- [Canton Network Documentation](https://docs.canton.network/)
- [Module 3: Contract Templates](https://docs.canton.network/appdev/modules/m3-contract-templates)
- [Module 4: JSON API Tutorial](https://docs.canton.network/appdev/modules/m4-json-api-tutorial)
- [Module 7: Canton Coin Preapprovals](https://docs.canton.network/appdev/modules/m7-canton-coin-preapprovals)
