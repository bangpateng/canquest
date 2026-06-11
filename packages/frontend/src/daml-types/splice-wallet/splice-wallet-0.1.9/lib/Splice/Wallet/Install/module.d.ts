// Generated from Splice/Wallet/Install.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520 from '@daml.js/splice-api-token-allocation-instruction-v1-1.0.0';
import * as pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 from '@daml.js/splice-api-token-transfer-instruction-v1-1.0.0';
import * as pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4 from '@daml.js/daml-prim-DA-Types-1.0.0';
import * as pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7 from '@daml.js/splice-wallet-payments-0.1.9';
import * as pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d from '@daml.js/splice-api-token-allocation-v1-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 from '@daml.js/splice-amulet-0.1.9';
import * as pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946 from '@daml.js/daml-stdlib-DA-Time-Types-1.0.0';

import * as Splice_Wallet_BuyTrafficRequest from '../../../Splice/Wallet/BuyTrafficRequest/module';
import * as Splice_Wallet_TopUpState from '../../../Splice/Wallet/TopUpState/module';
import * as Splice_Wallet_TransferOffer from '../../../Splice/Wallet/TransferOffer/module';
import * as Splice_Wallet_TransferPreapproval from '../../../Splice/Wallet/TransferPreapproval/module';

export declare type WalletAppInstall_Allocation_Withdraw = {
  allocationCid: damlTypes.ContractId<pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation>;
  withdrawArg: pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation_Withdraw;
};

export declare const WalletAppInstall_Allocation_Withdraw:
  damlTypes.Serializable<WalletAppInstall_Allocation_Withdraw> & {
  }
;


export declare type WalletAppInstall_AllocationFactory_Allocate = {
  allocationFactory: damlTypes.ContractId<pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520.Splice.Api.Token.AllocationInstructionV1.AllocationFactory>;
  allocateArg: pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520.Splice.Api.Token.AllocationInstructionV1.AllocationFactory_Allocate;
};

export declare const WalletAppInstall_AllocationFactory_Allocate:
  damlTypes.Serializable<WalletAppInstall_AllocationFactory_Allocate> & {
  }
;


export declare type WalletAppInstall_TransferInstruction_Withdraw = {
  transferInstructionCid: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction>;
  withdrawArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction_Withdraw;
};

export declare const WalletAppInstall_TransferInstruction_Withdraw:
  damlTypes.Serializable<WalletAppInstall_TransferInstruction_Withdraw> & {
  }
;


export declare type WalletAppInstall_TransferInstruction_Reject = {
  transferInstructionCid: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction>;
  rejectArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction_Reject;
};

export declare const WalletAppInstall_TransferInstruction_Reject:
  damlTypes.Serializable<WalletAppInstall_TransferInstruction_Reject> & {
  }
;


export declare type WalletAppInstall_TransferInstruction_Accept = {
  transferInstructionCid: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction>;
  acceptArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction_Accept;
};

export declare const WalletAppInstall_TransferInstruction_Accept:
  damlTypes.Serializable<WalletAppInstall_TransferInstruction_Accept> & {
  }
;


export declare type WalletAppInstall_TransferFactory_Transfer = {
  transferFactoryCid: damlTypes.ContractId<pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory>;
  transferArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory_Transfer;
};

export declare const WalletAppInstall_TransferFactory_Transfer:
  damlTypes.Serializable<WalletAppInstall_TransferFactory_Transfer> & {
  }
;


export declare type WalletAppInstall_FeaturedAppRights_SelfGrant = {
  amuletRulesCid: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AmuletRules>;
};

export declare const WalletAppInstall_FeaturedAppRights_SelfGrant:
  damlTypes.Serializable<WalletAppInstall_FeaturedAppRights_SelfGrant> & {
  }
;


export declare type WalletAppInstall_FeaturedAppRights_Cancel = {
  cid: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.FeaturedAppRight>;
};

export declare const WalletAppInstall_FeaturedAppRights_Cancel:
  damlTypes.Serializable<WalletAppInstall_FeaturedAppRights_Cancel> & {
  }
;


export declare type WalletAppInstall_BuyTrafficRequest_Expire = {
  requestCid: damlTypes.ContractId<Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest>;
};

export declare const WalletAppInstall_BuyTrafficRequest_Expire:
  damlTypes.Serializable<WalletAppInstall_BuyTrafficRequest_Expire> & {
  }
;


export declare type WalletAppInstall_BuyTrafficRequest_Cancel = {
  requestCid: damlTypes.ContractId<Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest>;
  reason: string;
};

export declare const WalletAppInstall_BuyTrafficRequest_Cancel:
  damlTypes.Serializable<WalletAppInstall_BuyTrafficRequest_Cancel> & {
  }
;


export declare type WalletAppInstall_CreateBuyTrafficRequest = {
  memberId: string;
  synchronizerId: string;
  migrationId: damlTypes.Int;
  trafficAmount: damlTypes.Int;
  expiresAt: damlTypes.Time;
  trackingId: string;
};

export declare const WalletAppInstall_CreateBuyTrafficRequest:
  damlTypes.Serializable<WalletAppInstall_CreateBuyTrafficRequest> & {
  }
;


export declare type WalletAppInstall_AcceptedTransferOffer_Expire = {
  cid: damlTypes.ContractId<Splice_Wallet_TransferOffer.AcceptedTransferOffer>;
};

export declare const WalletAppInstall_AcceptedTransferOffer_Expire:
  damlTypes.Serializable<WalletAppInstall_AcceptedTransferOffer_Expire> & {
  }
;


export declare type WalletAppInstall_AcceptedTransferOffer_Withdraw = {
  cid: damlTypes.ContractId<Splice_Wallet_TransferOffer.AcceptedTransferOffer>;
  reason: string;
};

export declare const WalletAppInstall_AcceptedTransferOffer_Withdraw:
  damlTypes.Serializable<WalletAppInstall_AcceptedTransferOffer_Withdraw> & {
  }
;


export declare type WalletAppInstall_AcceptedTransferOffer_Abort = {
  cid: damlTypes.ContractId<Splice_Wallet_TransferOffer.AcceptedTransferOffer>;
  reason: string;
};

export declare const WalletAppInstall_AcceptedTransferOffer_Abort:
  damlTypes.Serializable<WalletAppInstall_AcceptedTransferOffer_Abort> & {
  }
;


export declare type WalletAppInstall_TransferOffer_Expire = {
  cid: damlTypes.ContractId<Splice_Wallet_TransferOffer.TransferOffer>;
};

export declare const WalletAppInstall_TransferOffer_Expire:
  damlTypes.Serializable<WalletAppInstall_TransferOffer_Expire> & {
  }
;


export declare type WalletAppInstall_TransferOffer_Withdraw = {
  cid: damlTypes.ContractId<Splice_Wallet_TransferOffer.TransferOffer>;
  reason: string;
};

export declare const WalletAppInstall_TransferOffer_Withdraw:
  damlTypes.Serializable<WalletAppInstall_TransferOffer_Withdraw> & {
  }
;


export declare type WalletAppInstall_TransferOffer_Reject = {
  cid: damlTypes.ContractId<Splice_Wallet_TransferOffer.TransferOffer>;
};

export declare const WalletAppInstall_TransferOffer_Reject:
  damlTypes.Serializable<WalletAppInstall_TransferOffer_Reject> & {
  }
;


export declare type WalletAppInstall_TransferOffer_Accept = {
  cid: damlTypes.ContractId<Splice_Wallet_TransferOffer.TransferOffer>;
};

export declare const WalletAppInstall_TransferOffer_Accept:
  damlTypes.Serializable<WalletAppInstall_TransferOffer_Accept> & {
  }
;


export declare type WalletAppInstall_CreateTransferOffer = {
  receiver: damlTypes.Party;
  amount: pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.PaymentAmount;
  description: string;
  expiresAt: damlTypes.Time;
  trackingId: string;
};

export declare const WalletAppInstall_CreateTransferOffer:
  damlTypes.Serializable<WalletAppInstall_CreateTransferOffer> & {
  }
;


export declare type WalletAppInstall_SubscriptionIdleState_CancelSubscription = {
  cid: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionIdleState>;
};

export declare const WalletAppInstall_SubscriptionIdleState_CancelSubscription:
  damlTypes.Serializable<WalletAppInstall_SubscriptionIdleState_CancelSubscription> & {
  }
;


export declare type WalletAppInstall_SubscriptionRequest_Reject = {
  cid: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionRequest>;
};

export declare const WalletAppInstall_SubscriptionRequest_Reject:
  damlTypes.Serializable<WalletAppInstall_SubscriptionRequest_Reject> & {
  }
;


export declare type WalletAppInstall_AppPaymentRequest_Expire = {
  cid: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AppPaymentRequest>;
};

export declare const WalletAppInstall_AppPaymentRequest_Expire:
  damlTypes.Serializable<WalletAppInstall_AppPaymentRequest_Expire> & {
  }
;


export declare type WalletAppInstall_AppPaymentRequest_Reject = {
  cid: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AppPaymentRequest>;
};

export declare const WalletAppInstall_AppPaymentRequest_Reject:
  damlTypes.Serializable<WalletAppInstall_AppPaymentRequest_Reject> & {
  }
;


export declare type WalletAppInstall_ExecuteBatch = {
  context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext;
  inputs: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput[];
  operations: AmuletOperation[];
};

export declare const WalletAppInstall_ExecuteBatch:
  damlTypes.Serializable<WalletAppInstall_ExecuteBatch> & {
  }
;


export declare type WalletAppInstall = {
  dsoParty: damlTypes.Party;
  validatorParty: damlTypes.Party;
  endUserName: string;
  endUserParty: damlTypes.Party;
};

export declare interface WalletAppInstallInterface {
  WalletAppInstall_ExecuteBatch: damlTypes.Choice<WalletAppInstall, WalletAppInstall_ExecuteBatch, WalletAppInstall_ExecuteBatchResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_AppPaymentRequest_Reject: damlTypes.Choice<WalletAppInstall, WalletAppInstall_AppPaymentRequest_Reject, WalletAppInstall_AppPaymentRequest_RejectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_AppPaymentRequest_Expire: damlTypes.Choice<WalletAppInstall, WalletAppInstall_AppPaymentRequest_Expire, WalletAppInstall_AppPaymentRequest_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_SubscriptionRequest_Reject: damlTypes.Choice<WalletAppInstall, WalletAppInstall_SubscriptionRequest_Reject, WalletAppInstall_SubscriptionRequest_RejectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_SubscriptionIdleState_CancelSubscription: damlTypes.Choice<WalletAppInstall, WalletAppInstall_SubscriptionIdleState_CancelSubscription, WalletAppInstall_SubscriptionIdleState_CancelSubscriptionResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_CreateTransferOffer: damlTypes.Choice<WalletAppInstall, WalletAppInstall_CreateTransferOffer, WalletAppInstall_CreateTransferOfferResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_TransferOffer_Accept: damlTypes.Choice<WalletAppInstall, WalletAppInstall_TransferOffer_Accept, WalletAppInstall_TransferOffer_AcceptResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_TransferOffer_Reject: damlTypes.Choice<WalletAppInstall, WalletAppInstall_TransferOffer_Reject, WalletAppInstall_TransferOffer_RejectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_TransferOffer_Withdraw: damlTypes.Choice<WalletAppInstall, WalletAppInstall_TransferOffer_Withdraw, WalletAppInstall_TransferOffer_WithdrawResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_TransferOffer_Expire: damlTypes.Choice<WalletAppInstall, WalletAppInstall_TransferOffer_Expire, WalletAppInstall_TransferOffer_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_AcceptedTransferOffer_Abort: damlTypes.Choice<WalletAppInstall, WalletAppInstall_AcceptedTransferOffer_Abort, WalletAppInstall_AcceptedTransferOffer_AbortResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_AcceptedTransferOffer_Withdraw: damlTypes.Choice<WalletAppInstall, WalletAppInstall_AcceptedTransferOffer_Withdraw, WalletAppInstall_AcceptedTransferOffer_WithdrawResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_AcceptedTransferOffer_Expire: damlTypes.Choice<WalletAppInstall, WalletAppInstall_AcceptedTransferOffer_Expire, WalletAppInstall_AcceptedTransferOffer_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_CreateBuyTrafficRequest: damlTypes.Choice<WalletAppInstall, WalletAppInstall_CreateBuyTrafficRequest, WalletAppInstall_CreateBuyTrafficRequestResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_BuyTrafficRequest_Cancel: damlTypes.Choice<WalletAppInstall, WalletAppInstall_BuyTrafficRequest_Cancel, WalletAppInstall_BuyTrafficRequest_CancelResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_BuyTrafficRequest_Expire: damlTypes.Choice<WalletAppInstall, WalletAppInstall_BuyTrafficRequest_Expire, WalletAppInstall_BuyTrafficRequest_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_FeaturedAppRights_Cancel: damlTypes.Choice<WalletAppInstall, WalletAppInstall_FeaturedAppRights_Cancel, WalletAppInstall_FeaturedAppRights_CancelResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_FeaturedAppRights_SelfGrant: damlTypes.Choice<WalletAppInstall, WalletAppInstall_FeaturedAppRights_SelfGrant, WalletAppInstall_FeaturedAppRights_SelfGrantResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_TransferFactory_Transfer: damlTypes.Choice<WalletAppInstall, WalletAppInstall_TransferFactory_Transfer, pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_TransferInstruction_Accept: damlTypes.Choice<WalletAppInstall, WalletAppInstall_TransferInstruction_Accept, pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_TransferInstruction_Reject: damlTypes.Choice<WalletAppInstall, WalletAppInstall_TransferInstruction_Reject, pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_TransferInstruction_Withdraw: damlTypes.Choice<WalletAppInstall, WalletAppInstall_TransferInstruction_Withdraw, pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_AllocationFactory_Allocate: damlTypes.Choice<WalletAppInstall, WalletAppInstall_AllocationFactory_Allocate, pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520.Splice.Api.Token.AllocationInstructionV1.AllocationInstructionResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  Archive: damlTypes.Choice<WalletAppInstall, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
  WalletAppInstall_Allocation_Withdraw: damlTypes.Choice<WalletAppInstall, WalletAppInstall_Allocation_Withdraw, pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation_WithdrawResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<WalletAppInstall, undefined>>;
}
export declare const WalletAppInstall:
  damlTypes.Template<WalletAppInstall, undefined, '#splice-wallet:Splice.Wallet.Install:WalletAppInstall'> &
  damlTypes.ToInterface<WalletAppInstall, never> &
  WalletAppInstallInterface;

export declare namespace WalletAppInstall {
}



export declare type WalletAppInstall_TransferPreapprovalProposal_CreateResult = {
  preapprovalProposalCid: damlTypes.ContractId<Splice_Wallet_TransferPreapproval.TransferPreapprovalProposal>;
};

export declare const WalletAppInstall_TransferPreapprovalProposal_CreateResult:
  damlTypes.Serializable<WalletAppInstall_TransferPreapprovalProposal_CreateResult> & {
  }
;


export declare type WalletAppInstall_FeaturedAppRights_SelfGrantResult = {
  featuredAppRight: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.FeaturedAppRight>;
};

export declare const WalletAppInstall_FeaturedAppRights_SelfGrantResult:
  damlTypes.Serializable<WalletAppInstall_FeaturedAppRights_SelfGrantResult> & {
  }
;


export declare type WalletAppInstall_FeaturedAppRights_CancelResult =
  | 'WalletAppInstall_FeaturedAppRights_CancelResult'
;

export declare const WalletAppInstall_FeaturedAppRights_CancelResult:
  damlTypes.Serializable<WalletAppInstall_FeaturedAppRights_CancelResult> & {
  }
& { readonly keys: WalletAppInstall_FeaturedAppRights_CancelResult[] } & { readonly [e in WalletAppInstall_FeaturedAppRights_CancelResult]: e }
;


export declare type WalletAppInstall_BuyTrafficRequest_ExpireResult = {
  trackingInfo: Splice_Wallet_BuyTrafficRequest.BuyTrafficRequestTrackingInfo;
};

export declare const WalletAppInstall_BuyTrafficRequest_ExpireResult:
  damlTypes.Serializable<WalletAppInstall_BuyTrafficRequest_ExpireResult> & {
  }
;


export declare type WalletAppInstall_BuyTrafficRequest_CancelResult = {
  trackingInfo: Splice_Wallet_BuyTrafficRequest.BuyTrafficRequestTrackingInfo;
};

export declare const WalletAppInstall_BuyTrafficRequest_CancelResult:
  damlTypes.Serializable<WalletAppInstall_BuyTrafficRequest_CancelResult> & {
  }
;


export declare type WalletAppInstall_CreateBuyTrafficRequestResult = {
  buyTrafficRequest: damlTypes.ContractId<Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest>;
};

export declare const WalletAppInstall_CreateBuyTrafficRequestResult:
  damlTypes.Serializable<WalletAppInstall_CreateBuyTrafficRequestResult> & {
  }
;


export declare type WalletAppInstall_AcceptedTransferOffer_ExpireResult = {
  trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo;
};

export declare const WalletAppInstall_AcceptedTransferOffer_ExpireResult:
  damlTypes.Serializable<WalletAppInstall_AcceptedTransferOffer_ExpireResult> & {
  }
;


export declare type WalletAppInstall_AcceptedTransferOffer_WithdrawResult = {
  trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo;
};

export declare const WalletAppInstall_AcceptedTransferOffer_WithdrawResult:
  damlTypes.Serializable<WalletAppInstall_AcceptedTransferOffer_WithdrawResult> & {
  }
;


export declare type WalletAppInstall_AcceptedTransferOffer_AbortResult = {
  trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo;
};

export declare const WalletAppInstall_AcceptedTransferOffer_AbortResult:
  damlTypes.Serializable<WalletAppInstall_AcceptedTransferOffer_AbortResult> & {
  }
;


export declare type WalletAppInstall_TransferOffer_ExpireResult = {
  trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo;
};

export declare const WalletAppInstall_TransferOffer_ExpireResult:
  damlTypes.Serializable<WalletAppInstall_TransferOffer_ExpireResult> & {
  }
;


export declare type WalletAppInstall_TransferOffer_WithdrawResult = {
  trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo;
};

export declare const WalletAppInstall_TransferOffer_WithdrawResult:
  damlTypes.Serializable<WalletAppInstall_TransferOffer_WithdrawResult> & {
  }
;


export declare type WalletAppInstall_TransferOffer_RejectResult = {
  trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo;
};

export declare const WalletAppInstall_TransferOffer_RejectResult:
  damlTypes.Serializable<WalletAppInstall_TransferOffer_RejectResult> & {
  }
;


export declare type WalletAppInstall_TransferOffer_AcceptResult = {
  acceptedTransferOffer: damlTypes.ContractId<Splice_Wallet_TransferOffer.AcceptedTransferOffer>;
};

export declare const WalletAppInstall_TransferOffer_AcceptResult:
  damlTypes.Serializable<WalletAppInstall_TransferOffer_AcceptResult> & {
  }
;


export declare type WalletAppInstall_CreateTransferOfferResult = {
  transferOffer: damlTypes.ContractId<Splice_Wallet_TransferOffer.TransferOffer>;
};

export declare const WalletAppInstall_CreateTransferOfferResult:
  damlTypes.Serializable<WalletAppInstall_CreateTransferOfferResult> & {
  }
;


export declare type WalletAppInstall_SubscriptionIdleState_CancelSubscriptionResult = {
  terminatedSubscription: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.TerminatedSubscription>;
};

export declare const WalletAppInstall_SubscriptionIdleState_CancelSubscriptionResult:
  damlTypes.Serializable<WalletAppInstall_SubscriptionIdleState_CancelSubscriptionResult> & {
  }
;


export declare type WalletAppInstall_SubscriptionRequest_RejectResult = {
  terminatedSubscription: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.TerminatedSubscription>;
};

export declare const WalletAppInstall_SubscriptionRequest_RejectResult:
  damlTypes.Serializable<WalletAppInstall_SubscriptionRequest_RejectResult> & {
  }
;


export declare type WalletAppInstall_AppPaymentRequest_ExpireResult = {
  terminatedAppPayment: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.TerminatedAppPayment>;
};

export declare const WalletAppInstall_AppPaymentRequest_ExpireResult:
  damlTypes.Serializable<WalletAppInstall_AppPaymentRequest_ExpireResult> & {
  }
;


export declare type WalletAppInstall_AppPaymentRequest_RejectResult = {
  terminatedAppPayment: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.TerminatedAppPayment>;
};

export declare const WalletAppInstall_AppPaymentRequest_RejectResult:
  damlTypes.Serializable<WalletAppInstall_AppPaymentRequest_RejectResult> & {
  }
;


export declare type WalletAppInstall_ExecuteBatchResult = {
  endUserName: string;
  outcomes: AmuletOperationOutcome[];
  optEndUserParty: damlTypes.Optional<damlTypes.Party>;
};

export declare const WalletAppInstall_ExecuteBatchResult:
  damlTypes.Serializable<WalletAppInstall_ExecuteBatchResult> & {
  }
;


export declare type AmuletOperationOutcome =
  |  { tag: 'COO_AcceptedAppPayment'; value: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AcceptedAppPayment> }
  |  { tag: 'COO_CompleteAcceptedTransfer'; value: pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferResult, Splice_Wallet_TransferOffer.TransferOfferTrackingInfo> }
  |  { tag: 'COO_SubscriptionInitialPayment'; value: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionInitialPayment> }
  |  { tag: 'COO_SubscriptionPayment'; value: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionPayment> }
  |  { tag: 'COO_MergeTransferInputs'; value: damlTypes.Optional<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>> }
  |  { tag: 'COO_BuyMemberTraffic'; value: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.DecentralizedSynchronizer.MemberTraffic> }
  |  { tag: 'COO_CompleteBuyTrafficRequest'; value: pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.DecentralizedSynchronizer.MemberTraffic>, Splice_Wallet_BuyTrafficRequest.BuyTrafficRequestTrackingInfo> }
  |  { tag: 'COO_Tap'; value: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet> }
  |  { tag: 'COO_Error'; value: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.InvalidTransferReason }
  |  { tag: 'ExtAmuletOperationOutcome'; value: AmuletOperationOutcome.ExtAmuletOperationOutcome }
  |  { tag: 'COO_CreateExternalPartySetupProposal'; value: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.ExternalPartySetupProposal> }
  |  { tag: 'COO_AcceptTransferPreapprovalProposal'; value: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval> }
  |  { tag: 'COO_RenewTransferPreapproval'; value: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval> }
  |  { tag: 'COO_TransferPreapprovalSend'; value: damlTypes.Optional<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>> }
;

export declare const AmuletOperationOutcome:
  damlTypes.Serializable<AmuletOperationOutcome> & {
  ExtAmuletOperationOutcome: damlTypes.Serializable<AmuletOperationOutcome.ExtAmuletOperationOutcome>;
  }
;


export namespace AmuletOperationOutcome {
  type ExtAmuletOperationOutcome = {
    dummyUnitField: {};
  };
} //namespace AmuletOperationOutcome


export declare type AmuletOperation =
  |  { tag: 'CO_AppPayment'; value: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AppPaymentRequest> }
  |  { tag: 'CO_CompleteAcceptedTransfer'; value: damlTypes.ContractId<Splice_Wallet_TransferOffer.AcceptedTransferOffer> }
  |  { tag: 'CO_SubscriptionAcceptAndMakeInitialPayment'; value: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionRequest> }
  |  { tag: 'CO_SubscriptionMakePayment'; value: damlTypes.ContractId<pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionIdleState> }
  |  { tag: 'CO_MergeTransferInputs'; value: {} }
  |  { tag: 'CO_BuyMemberTraffic'; value: AmuletOperation.CO_BuyMemberTraffic }
  |  { tag: 'CO_CompleteBuyTrafficRequest'; value: AmuletOperation.CO_CompleteBuyTrafficRequest }
  |  { tag: 'CO_Tap'; value: AmuletOperation.CO_Tap }
  |  { tag: 'ExtAmuletOperation'; value: AmuletOperation.ExtAmuletOperation }
  |  { tag: 'CO_CreateExternalPartySetupProposal'; value: AmuletOperation.CO_CreateExternalPartySetupProposal }
  |  { tag: 'CO_AcceptTransferPreapprovalProposal'; value: AmuletOperation.CO_AcceptTransferPreapprovalProposal }
  |  { tag: 'CO_RenewTransferPreapproval'; value: AmuletOperation.CO_RenewTransferPreapproval }
  |  { tag: 'CO_TransferPreapprovalSend'; value: AmuletOperation.CO_TransferPreapprovalSend }
;

export declare const AmuletOperation:
  damlTypes.Serializable<AmuletOperation> & {
  CO_BuyMemberTraffic: damlTypes.Serializable<AmuletOperation.CO_BuyMemberTraffic>;
  CO_CompleteBuyTrafficRequest: damlTypes.Serializable<AmuletOperation.CO_CompleteBuyTrafficRequest>;
  CO_Tap: damlTypes.Serializable<AmuletOperation.CO_Tap>;
  ExtAmuletOperation: damlTypes.Serializable<AmuletOperation.ExtAmuletOperation>;
  CO_CreateExternalPartySetupProposal: damlTypes.Serializable<AmuletOperation.CO_CreateExternalPartySetupProposal>;
  CO_AcceptTransferPreapprovalProposal: damlTypes.Serializable<AmuletOperation.CO_AcceptTransferPreapprovalProposal>;
  CO_RenewTransferPreapproval: damlTypes.Serializable<AmuletOperation.CO_RenewTransferPreapproval>;
  CO_TransferPreapprovalSend: damlTypes.Serializable<AmuletOperation.CO_TransferPreapprovalSend>;
  }
;


export namespace AmuletOperation {
  type CO_BuyMemberTraffic = {
    trafficAmount: damlTypes.Int;
    memberId: string;
    synchronizerId: string;
    migrationId: damlTypes.Int;
    minTopupInterval: pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime;
    topupStateCid: damlTypes.Optional<damlTypes.ContractId<Splice_Wallet_TopUpState.ValidatorTopUpState>>;
  };
} //namespace AmuletOperation


export namespace AmuletOperation {
  type CO_CompleteBuyTrafficRequest = {
    trafficRequestCid: damlTypes.ContractId<Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest>;
  };
} //namespace AmuletOperation


export namespace AmuletOperation {
  type CO_Tap = {
    tapAmount: damlTypes.Numeric;
  };
} //namespace AmuletOperation


export namespace AmuletOperation {
  type ExtAmuletOperation = {
    dummyUnitField: {};
  };
} //namespace AmuletOperation


export namespace AmuletOperation {
  type CO_CreateExternalPartySetupProposal = {
    externalParty: damlTypes.Party;
    preapprovalExpiresAt: damlTypes.Time;
  };
} //namespace AmuletOperation


export namespace AmuletOperation {
  type CO_AcceptTransferPreapprovalProposal = {
    preapprovalProposalCid: damlTypes.ContractId<Splice_Wallet_TransferPreapproval.TransferPreapprovalProposal>;
    expiresAt: damlTypes.Time;
  };
} //namespace AmuletOperation


export namespace AmuletOperation {
  type CO_RenewTransferPreapproval = {
    previousApprovalCid: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval>;
    newExpiresAt: damlTypes.Time;
  };
} //namespace AmuletOperation


export namespace AmuletOperation {
  type CO_TransferPreapprovalSend = {
    transferPreapprovalCid: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval>;
    providerFeaturedAppRightCid: damlTypes.Optional<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.FeaturedAppRight>>;
    amount: damlTypes.Numeric;
    description: damlTypes.Optional<string>;
  };
} //namespace AmuletOperation


export declare type ExecutionContext = {
  dso: damlTypes.Party;
  endUser: damlTypes.Party;
  validator: damlTypes.Party;
  paymentContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext;
};

export declare const ExecutionContext:
  damlTypes.Serializable<ExecutionContext> & {
  }
;

