// Generated from Main.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4 from '@daml.js/daml-prim-DA-Types-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';

export declare type SettleCcTransaction = {
  txId: string;
  settledAt: string;
};

export declare const SettleCcTransaction:
  damlTypes.Serializable<SettleCcTransaction> & {
  }
;


export declare type CcTransactionLog = {
  admin: damlTypes.Party;
  userAddress: damlTypes.Party;
  username: string;
  txLogId: string;
  txType: string;
  amountMicroCc: damlTypes.Int;
  description: string;
  referenceId: string;
  ledgerTxId: string;
  createdAt: string;
};

export declare interface CcTransactionLogInterface {
  Archive: damlTypes.Choice<CcTransactionLog, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<CcTransactionLog, undefined>>;
  SettleCcTransaction: damlTypes.Choice<CcTransactionLog, SettleCcTransaction, damlTypes.ContractId<CcTransactionLog>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<CcTransactionLog, undefined>>;
}
export declare const CcTransactionLog:
  damlTypes.Template<CcTransactionLog, undefined, '#canquest-v11:Main:CcTransactionLog'> &
  damlTypes.ToInterface<CcTransactionLog, never> &
  CcTransactionLogInterface;

export declare namespace CcTransactionLog {
}



export declare type ConfirmReferralProcessed = {
  confirmedAt: string;
};

export declare const ConfirmReferralProcessed:
  damlTypes.Serializable<ConfirmReferralProcessed> & {
  }
;


export declare type ReferralReward = {
  admin: damlTypes.Party;
  referrerAddress: damlTypes.Party;
  referrerId: string;
  referredUserId: string;
  points: damlTypes.Int;
  referralId: string;
  createdAt: string;
};

export declare interface ReferralRewardInterface {
  ConfirmReferralProcessed: damlTypes.Choice<ReferralReward, ConfirmReferralProcessed, damlTypes.ContractId<ReferralReward>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<ReferralReward, undefined>>;
  Archive: damlTypes.Choice<ReferralReward, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<ReferralReward, undefined>>;
}
export declare const ReferralReward:
  damlTypes.Template<ReferralReward, undefined, '#canquest-v11:Main:ReferralReward'> &
  damlTypes.ToInterface<ReferralReward, never> &
  ReferralRewardInterface;

export declare namespace ReferralReward {
}



export declare type SpinCcReward = {
  admin: damlTypes.Party;
  userAddress: damlTypes.Party;
  username: string;
  spinResultId: string;
  rewardCc: damlTypes.Numeric;
  spliceTxId: string;
  deliveredAt: string;
};

export declare interface SpinCcRewardInterface {
  Archive: damlTypes.Choice<SpinCcReward, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SpinCcReward, undefined>>;
}
export declare const SpinCcReward:
  damlTypes.Template<SpinCcReward, undefined, '#canquest-v11:Main:SpinCcReward'> &
  damlTypes.ToInterface<SpinCcReward, never> &
  SpinCcRewardInterface;

export declare namespace SpinCcReward {
}



export declare type ConfirmCcDelivered = {
  spliceTxId: string;
  deliveredAt: string;
};

export declare const ConfirmCcDelivered:
  damlTypes.Serializable<ConfirmCcDelivered> & {
  }
;


export declare type SpinExecution = {
  admin: damlTypes.Party;
  userAddress: damlTypes.Party;
  username: string;
  spinResultId: string;
  spinItemId: string;
  spinItemLabel: string;
  rewardType: string;
  rewardCc: damlTypes.Numeric;
  rewardPoints: string;
  spinCost: string;
  executedAt: string;
};

export declare interface SpinExecutionInterface {
  ConfirmCcDelivered: damlTypes.Choice<SpinExecution, ConfirmCcDelivered, damlTypes.ContractId<SpinCcReward>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SpinExecution, undefined>>;
  Archive: damlTypes.Choice<SpinExecution, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SpinExecution, undefined>>;
}
export declare const SpinExecution:
  damlTypes.Template<SpinExecution, undefined, '#canquest-v11:Main:SpinExecution'> &
  damlTypes.ToInterface<SpinExecution, never> &
  SpinExecutionInterface;

export declare namespace SpinExecution {
}



export declare type VerifyCheckIn = {
  verifiedAt: string;
};

export declare const VerifyCheckIn:
  damlTypes.Serializable<VerifyCheckIn> & {
  }
;


export declare type DailyCheckIn = {
  admin: damlTypes.Party;
  userAddress: damlTypes.Party;
  username: string;
  checkInId: string;
  checkInDate: string;
  pointsAwarded: damlTypes.Int;
  streakCount: damlTypes.Int;
  checkedInAt: string;
};

export declare interface DailyCheckInInterface {
  VerifyCheckIn: damlTypes.Choice<DailyCheckIn, VerifyCheckIn, damlTypes.ContractId<DailyCheckIn>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<DailyCheckIn, undefined>>;
  Archive: damlTypes.Choice<DailyCheckIn, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<DailyCheckIn, undefined>>;
}
export declare const DailyCheckIn:
  damlTypes.Template<DailyCheckIn, undefined, '#canquest-v11:Main:DailyCheckIn'> &
  damlTypes.ToInterface<DailyCheckIn, never> &
  DailyCheckInInterface;

export declare namespace DailyCheckIn {
}



export declare type AtomicFeeAndReward = {
  feeTxId: string;
  feeConfirmedAt: string;
  rewardTxId: string;
  rewardSentAt: string;
  txLogId: string;
  amountMicroCc: damlTypes.Int;
  description: string;
  referenceId: string;
};

export declare const AtomicFeeAndReward:
  damlTypes.Serializable<AtomicFeeAndReward> & {
  }
;


export declare type RevealRewardCode = {
  code: string;
  revealedAt: string;
};

export declare const RevealRewardCode:
  damlTypes.Serializable<RevealRewardCode> & {
  }
;


export declare type ConfirmRewardSent = {
  txId: string;
  sentAt: string;
};

export declare const ConfirmRewardSent:
  damlTypes.Serializable<ConfirmRewardSent> & {
  }
;


export declare type ConfirmFeePaid = {
  txId: string;
  confirmedAt: string;
};

export declare const ConfirmFeePaid:
  damlTypes.Serializable<ConfirmFeePaid> & {
  }
;


export declare type QuestClaim = {
  admin: damlTypes.Party;
  userAddress: damlTypes.Party;
  campaignId: string;
  claimId: string;
  claimKind: string;
  rewardCc: damlTypes.Numeric;
  rewardCode: string;
  claimFeeCc: damlTypes.Numeric;
  feePaid: boolean;
  feeTxId: string;
  rewardSent: boolean;
  rewardTxId: string;
  claimedAt: string;
};

export declare interface QuestClaimInterface {
  ConfirmFeePaid: damlTypes.Choice<QuestClaim, ConfirmFeePaid, damlTypes.ContractId<QuestClaim>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestClaim, undefined>>;
  ConfirmRewardSent: damlTypes.Choice<QuestClaim, ConfirmRewardSent, damlTypes.ContractId<QuestClaim>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestClaim, undefined>>;
  RevealRewardCode: damlTypes.Choice<QuestClaim, RevealRewardCode, damlTypes.ContractId<QuestClaim>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestClaim, undefined>>;
  AtomicFeeAndReward: damlTypes.Choice<QuestClaim, AtomicFeeAndReward, pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple3<damlTypes.ContractId<QuestClaim>, damlTypes.ContractId<QuestClaim>, damlTypes.ContractId<CcTransactionLog>>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestClaim, undefined>>;
  Archive: damlTypes.Choice<QuestClaim, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestClaim, undefined>>;
}
export declare const QuestClaim:
  damlTypes.Template<QuestClaim, undefined, '#canquest-v11:Main:QuestClaim'> &
  damlTypes.ToInterface<QuestClaim, never> &
  QuestClaimInterface;

export declare namespace QuestClaim {
}



export declare type UpdateCampaignStatus = {
  newStatus: string;
  updatedAt: string;
};

export declare const UpdateCampaignStatus:
  damlTypes.Serializable<UpdateCampaignStatus> & {
  }
;


export declare type CloseCampaign = {
  closedAt: string;
};

export declare const CloseCampaign:
  damlTypes.Serializable<CloseCampaign> & {
  }
;


export declare type DrawRaffleWinner = {
  user: damlTypes.Party;
  claimId: string;
  rewardCode: string;
  drawnAt: string;
};

export declare const DrawRaffleWinner:
  damlTypes.Serializable<DrawRaffleWinner> & {
  }
;


export declare type ClaimFcfsSlot = {
  user: damlTypes.Party;
  claimId: string;
  claimedAt: string;
};

export declare const ClaimFcfsSlot:
  damlTypes.Serializable<ClaimFcfsSlot> & {
  }
;


export declare type QuestCampaign = {
  admin: damlTypes.Party;
  campaignId: string;
  title: string;
  questKind: string;
  rewardCc: damlTypes.Numeric;
  claimFeeCc: damlTypes.Numeric;
  maxWinners: damlTypes.Int;
  currentClaims: damlTypes.Int;
  status: string;
  createdAt: string;
};

export declare interface QuestCampaignInterface {
  ClaimFcfsSlot: damlTypes.Choice<QuestCampaign, ClaimFcfsSlot, pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2<damlTypes.ContractId<QuestCampaign>, damlTypes.ContractId<QuestClaim>>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestCampaign, undefined>>;
  DrawRaffleWinner: damlTypes.Choice<QuestCampaign, DrawRaffleWinner, pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2<damlTypes.ContractId<QuestCampaign>, damlTypes.ContractId<QuestClaim>>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestCampaign, undefined>>;
  CloseCampaign: damlTypes.Choice<QuestCampaign, CloseCampaign, damlTypes.ContractId<QuestCampaign>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestCampaign, undefined>>;
  UpdateCampaignStatus: damlTypes.Choice<QuestCampaign, UpdateCampaignStatus, damlTypes.ContractId<QuestCampaign>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestCampaign, undefined>>;
  Archive: damlTypes.Choice<QuestCampaign, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<QuestCampaign, undefined>>;
}
export declare const QuestCampaign:
  damlTypes.Template<QuestCampaign, undefined, '#canquest-v11:Main:QuestCampaign'> &
  damlTypes.ToInterface<QuestCampaign, never> &
  QuestCampaignInterface;

export declare namespace QuestCampaign {
}



export declare type ConfirmWalletActive = {
  confirmedAt: string;
};

export declare const ConfirmWalletActive:
  damlTypes.Serializable<ConfirmWalletActive> & {
  }
;


export declare type WalletRegistration = {
  admin: damlTypes.Party;
  userAddress: damlTypes.Party;
  username: string;
  partyId: string;
  inviteCode: string;
  registeredAt: string;
};

export declare interface WalletRegistrationInterface {
  ConfirmWalletActive: damlTypes.Choice<WalletRegistration, ConfirmWalletActive, damlTypes.ContractId<WalletRegistration>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletRegistration, undefined>>;
  Archive: damlTypes.Choice<WalletRegistration, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletRegistration, undefined>>;
}
export declare const WalletRegistration:
  damlTypes.Template<WalletRegistration, undefined, '#canquest-v11:Main:WalletRegistration'> &
  damlTypes.ToInterface<WalletRegistration, never> &
  WalletRegistrationInterface;

export declare namespace WalletRegistration {
}



export declare type UpdateUsername = {
  newUsername: string;
};

export declare const UpdateUsername:
  damlTypes.Serializable<UpdateUsername> & {
  }
;


export declare type DebitPoints = {
  amount: damlTypes.Int;
  reason: string;
};

export declare const DebitPoints:
  damlTypes.Serializable<DebitPoints> & {
  }
;


export declare type RewardPoints = {
  pointsToAdd: damlTypes.Int;
  reason: string;
};

export declare const RewardPoints:
  damlTypes.Serializable<RewardPoints> & {
  }
;


export declare type UserAccount = {
  admin: damlTypes.Party;
  userAddress: damlTypes.Party;
  username: string;
  earnedPoints: damlTypes.Int;
  spentPoints: damlTypes.Int;
  createdAt: string;
};

export declare interface UserAccountInterface {
  RewardPoints: damlTypes.Choice<UserAccount, RewardPoints, damlTypes.ContractId<UserAccount>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<UserAccount, undefined>>;
  DebitPoints: damlTypes.Choice<UserAccount, DebitPoints, damlTypes.ContractId<UserAccount>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<UserAccount, undefined>>;
  UpdateUsername: damlTypes.Choice<UserAccount, UpdateUsername, damlTypes.ContractId<UserAccount>, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<UserAccount, undefined>>;
  Archive: damlTypes.Choice<UserAccount, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<UserAccount, undefined>>;
}
export declare const UserAccount:
  damlTypes.Template<UserAccount, undefined, '#canquest-v11:Main:UserAccount'> &
  damlTypes.ToInterface<UserAccount, never> &
  UserAccountInterface;

export declare namespace UserAccount {
}


