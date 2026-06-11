// Generated from Splice/Wallet/Subscriptions.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 from '@daml.js/splice-amulet-0.1.9';
import * as pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946 from '@daml.js/daml-stdlib-DA-Time-Types-1.0.0';

import * as Splice_Wallet_Payment from '../../../Splice/Wallet/Payment/module';

export declare type SubscriptionPayment_Expire = {
  actor: damlTypes.Party;
  transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext;
};

export declare const SubscriptionPayment_Expire:
  damlTypes.Serializable<SubscriptionPayment_Expire> & {
  }
;


export declare type SubscriptionPayment_Reject = {
  transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext;
};

export declare const SubscriptionPayment_Reject:
  damlTypes.Serializable<SubscriptionPayment_Reject> & {
  }
;


export declare type SubscriptionPayment_Collect = {
  transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext;
};

export declare const SubscriptionPayment_Collect:
  damlTypes.Serializable<SubscriptionPayment_Collect> & {
  }
;


export declare type SubscriptionPayment = {
  subscription: damlTypes.ContractId<Subscription>;
  subscriptionData: SubscriptionData;
  payData: SubscriptionPayData;
  thisPaymentDueAt: damlTypes.Time;
  targetAmount: damlTypes.Numeric;
  lockedAmulet: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet>;
  round: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Types.Round;
  reference: damlTypes.ContractId<SubscriptionRequest>;
};

export declare interface SubscriptionPaymentInterface {
  SubscriptionPayment_Collect: damlTypes.Choice<SubscriptionPayment, SubscriptionPayment_Collect, SubscriptionPayment_CollectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionPayment, undefined>>;
  SubscriptionPayment_Reject: damlTypes.Choice<SubscriptionPayment, SubscriptionPayment_Reject, SubscriptionPayment_RejectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionPayment, undefined>>;
  SubscriptionPayment_Expire: damlTypes.Choice<SubscriptionPayment, SubscriptionPayment_Expire, SubscriptionPayment_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionPayment, undefined>>;
  Archive: damlTypes.Choice<SubscriptionPayment, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionPayment, undefined>>;
}
export declare const SubscriptionPayment:
  damlTypes.Template<SubscriptionPayment, undefined, '#splice-wallet-payments:Splice.Wallet.Subscriptions:SubscriptionPayment'> &
  damlTypes.ToInterface<SubscriptionPayment, never> &
  SubscriptionPaymentInterface;

export declare namespace SubscriptionPayment {
}



export declare type SubscriptionIdleState_CancelSubscription = {
};

export declare const SubscriptionIdleState_CancelSubscription:
  damlTypes.Serializable<SubscriptionIdleState_CancelSubscription> & {
  }
;


export declare type SubscriptionIdleState_ExpireSubscription = {
  actor: damlTypes.Party;
};

export declare const SubscriptionIdleState_ExpireSubscription:
  damlTypes.Serializable<SubscriptionIdleState_ExpireSubscription> & {
  }
;


export declare type SubscriptionIdleState_MakePayment = {
  inputs: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput[];
  context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext;
  walletProvider: damlTypes.Party;
};

export declare const SubscriptionIdleState_MakePayment:
  damlTypes.Serializable<SubscriptionIdleState_MakePayment> & {
  }
;


export declare type SubscriptionIdleState = {
  subscription: damlTypes.ContractId<Subscription>;
  subscriptionData: SubscriptionData;
  payData: SubscriptionPayData;
  nextPaymentDueAt: damlTypes.Time;
  reference: damlTypes.ContractId<SubscriptionRequest>;
};

export declare interface SubscriptionIdleStateInterface {
  SubscriptionIdleState_MakePayment: damlTypes.Choice<SubscriptionIdleState, SubscriptionIdleState_MakePayment, SubscriptionIdleState_MakePaymentResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionIdleState, undefined>>;
  SubscriptionIdleState_ExpireSubscription: damlTypes.Choice<SubscriptionIdleState, SubscriptionIdleState_ExpireSubscription, SubscriptionIdleState_ExpireSubscriptionResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionIdleState, undefined>>;
  SubscriptionIdleState_CancelSubscription: damlTypes.Choice<SubscriptionIdleState, SubscriptionIdleState_CancelSubscription, SubscriptionIdleState_CancelSubscriptionResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionIdleState, undefined>>;
  Archive: damlTypes.Choice<SubscriptionIdleState, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionIdleState, undefined>>;
}
export declare const SubscriptionIdleState:
  damlTypes.Template<SubscriptionIdleState, undefined, '#splice-wallet-payments:Splice.Wallet.Subscriptions:SubscriptionIdleState'> &
  damlTypes.ToInterface<SubscriptionIdleState, never> &
  SubscriptionIdleStateInterface;

export declare namespace SubscriptionIdleState {
}



export declare type SubscriptionInitialPayment_Expire = {
  actor: damlTypes.Party;
  transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext;
};

export declare const SubscriptionInitialPayment_Expire:
  damlTypes.Serializable<SubscriptionInitialPayment_Expire> & {
  }
;


export declare type SubscriptionInitialPayment_Reject = {
  transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext;
};

export declare const SubscriptionInitialPayment_Reject:
  damlTypes.Serializable<SubscriptionInitialPayment_Reject> & {
  }
;


export declare type SubscriptionInitialPayment_Collect = {
  transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext;
};

export declare const SubscriptionInitialPayment_Collect:
  damlTypes.Serializable<SubscriptionInitialPayment_Collect> & {
  }
;


export declare type SubscriptionInitialPayment = {
  subscriptionData: SubscriptionData;
  payData: SubscriptionPayData;
  targetAmount: damlTypes.Numeric;
  lockedAmulet: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet>;
  round: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Types.Round;
  reference: damlTypes.ContractId<SubscriptionRequest>;
};

export declare interface SubscriptionInitialPaymentInterface {
  SubscriptionInitialPayment_Collect: damlTypes.Choice<SubscriptionInitialPayment, SubscriptionInitialPayment_Collect, SubscriptionInitialPayment_CollectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionInitialPayment, undefined>>;
  SubscriptionInitialPayment_Reject: damlTypes.Choice<SubscriptionInitialPayment, SubscriptionInitialPayment_Reject, SubscriptionInitialPayment_RejectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionInitialPayment, undefined>>;
  SubscriptionInitialPayment_Expire: damlTypes.Choice<SubscriptionInitialPayment, SubscriptionInitialPayment_Expire, SubscriptionInitialPayment_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionInitialPayment, undefined>>;
  Archive: damlTypes.Choice<SubscriptionInitialPayment, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionInitialPayment, undefined>>;
}
export declare const SubscriptionInitialPayment:
  damlTypes.Template<SubscriptionInitialPayment, undefined, '#splice-wallet-payments:Splice.Wallet.Subscriptions:SubscriptionInitialPayment'> &
  damlTypes.ToInterface<SubscriptionInitialPayment, never> &
  SubscriptionInitialPaymentInterface;

export declare namespace SubscriptionInitialPayment {
}



export declare type SubscriptionRequest_Reject = {
};

export declare const SubscriptionRequest_Reject:
  damlTypes.Serializable<SubscriptionRequest_Reject> & {
  }
;


export declare type SubscriptionRequest_Withdraw = {
};

export declare const SubscriptionRequest_Withdraw:
  damlTypes.Serializable<SubscriptionRequest_Withdraw> & {
  }
;


export declare type SubscriptionRequest_AcceptAndMakePayment = {
  inputs: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput[];
  context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext;
  walletProvider: damlTypes.Party;
};

export declare const SubscriptionRequest_AcceptAndMakePayment:
  damlTypes.Serializable<SubscriptionRequest_AcceptAndMakePayment> & {
  }
;


export declare type SubscriptionRequest = {
  subscriptionData: SubscriptionData;
  payData: SubscriptionPayData;
};

export declare interface SubscriptionRequestInterface {
  SubscriptionRequest_AcceptAndMakePayment: damlTypes.Choice<SubscriptionRequest, SubscriptionRequest_AcceptAndMakePayment, SubscriptionRequest_AcceptAndMakePaymentResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionRequest, undefined>>;
  SubscriptionRequest_Withdraw: damlTypes.Choice<SubscriptionRequest, SubscriptionRequest_Withdraw, SubscriptionRequest_WithdrawResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionRequest, undefined>>;
  SubscriptionRequest_Reject: damlTypes.Choice<SubscriptionRequest, SubscriptionRequest_Reject, SubscriptionRequest_RejectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionRequest, undefined>>;
  Archive: damlTypes.Choice<SubscriptionRequest, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<SubscriptionRequest, undefined>>;
}
export declare const SubscriptionRequest:
  damlTypes.Template<SubscriptionRequest, undefined, '#splice-wallet-payments:Splice.Wallet.Subscriptions:SubscriptionRequest'> &
  damlTypes.ToInterface<SubscriptionRequest, never> &
  SubscriptionRequestInterface;

export declare namespace SubscriptionRequest {
}



export declare type SubscriptionPayData = {
  paymentAmount: Splice_Wallet_Payment.PaymentAmount;
  paymentInterval: pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime;
  paymentDuration: pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime;
};

export declare const SubscriptionPayData:
  damlTypes.Serializable<SubscriptionPayData> & {
  }
;


export declare type TerminatedSubscription = {
  subscriptionData: SubscriptionData;
  reference: damlTypes.ContractId<SubscriptionRequest>;
};

export declare interface TerminatedSubscriptionInterface {
  Archive: damlTypes.Choice<TerminatedSubscription, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<TerminatedSubscription, undefined>>;
}
export declare const TerminatedSubscription:
  damlTypes.Template<TerminatedSubscription, undefined, '#splice-wallet-payments:Splice.Wallet.Subscriptions:TerminatedSubscription'> &
  damlTypes.ToInterface<TerminatedSubscription, never> &
  TerminatedSubscriptionInterface;

export declare namespace TerminatedSubscription {
}



export declare type Subscription_Archive = {
};

export declare const Subscription_Archive:
  damlTypes.Serializable<Subscription_Archive> & {
  }
;


export declare type Subscription = {
  subscriptionData: SubscriptionData;
  reference: damlTypes.ContractId<SubscriptionRequest>;
};

export declare interface SubscriptionInterface {
  Subscription_Archive: damlTypes.Choice<Subscription, Subscription_Archive, Subscription_ArchiveResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<Subscription, undefined>>;
  Archive: damlTypes.Choice<Subscription, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<Subscription, undefined>>;
}
export declare const Subscription:
  damlTypes.Template<Subscription, undefined, '#splice-wallet-payments:Splice.Wallet.Subscriptions:Subscription'> &
  damlTypes.ToInterface<Subscription, never> &
  SubscriptionInterface;

export declare namespace Subscription {
}



export declare type SubscriptionPayment_ExpireResult = {
  subscriptionState: damlTypes.ContractId<SubscriptionIdleState>;
  amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const SubscriptionPayment_ExpireResult:
  damlTypes.Serializable<SubscriptionPayment_ExpireResult> & {
  }
;


export declare type SubscriptionPayment_RejectResult = {
  subscriptionState: damlTypes.ContractId<SubscriptionIdleState>;
  amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const SubscriptionPayment_RejectResult:
  damlTypes.Serializable<SubscriptionPayment_RejectResult> & {
  }
;


export declare type SubscriptionPayment_CollectResult = {
  subscriptionState: damlTypes.ContractId<SubscriptionIdleState>;
  amulet: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>;
};

export declare const SubscriptionPayment_CollectResult:
  damlTypes.Serializable<SubscriptionPayment_CollectResult> & {
  }
;


export declare type SubscriptionIdleState_MakePaymentResult = {
  subscriptionPayment: damlTypes.ContractId<SubscriptionPayment>;
  senderChange: damlTypes.Optional<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const SubscriptionIdleState_MakePaymentResult:
  damlTypes.Serializable<SubscriptionIdleState_MakePaymentResult> & {
  }
;


export declare type SubscriptionIdleState_CancelSubscriptionResult = {
  terminatedSubscription: damlTypes.ContractId<TerminatedSubscription>;
};

export declare const SubscriptionIdleState_CancelSubscriptionResult:
  damlTypes.Serializable<SubscriptionIdleState_CancelSubscriptionResult> & {
  }
;


export declare type SubscriptionIdleState_ExpireSubscriptionResult = {
  terminatedSubscription: damlTypes.ContractId<TerminatedSubscription>;
};

export declare const SubscriptionIdleState_ExpireSubscriptionResult:
  damlTypes.Serializable<SubscriptionIdleState_ExpireSubscriptionResult> & {
  }
;


export declare type SubscriptionInitialPayment_ExpireResult = {
  amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const SubscriptionInitialPayment_ExpireResult:
  damlTypes.Serializable<SubscriptionInitialPayment_ExpireResult> & {
  }
;


export declare type SubscriptionInitialPayment_RejectResult = {
  amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const SubscriptionInitialPayment_RejectResult:
  damlTypes.Serializable<SubscriptionInitialPayment_RejectResult> & {
  }
;


export declare type SubscriptionInitialPayment_CollectResult = {
  subscription: damlTypes.ContractId<Subscription>;
  subscriptionState: damlTypes.ContractId<SubscriptionIdleState>;
  amulet: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>;
};

export declare const SubscriptionInitialPayment_CollectResult:
  damlTypes.Serializable<SubscriptionInitialPayment_CollectResult> & {
  }
;


export declare type SubscriptionRequest_RejectResult = {
  terminatedSubscription: damlTypes.ContractId<TerminatedSubscription>;
};

export declare const SubscriptionRequest_RejectResult:
  damlTypes.Serializable<SubscriptionRequest_RejectResult> & {
  }
;


export declare type SubscriptionRequest_WithdrawResult = {
  terminatedSubscription: damlTypes.ContractId<TerminatedSubscription>;
};

export declare const SubscriptionRequest_WithdrawResult:
  damlTypes.Serializable<SubscriptionRequest_WithdrawResult> & {
  }
;


export declare type SubscriptionRequest_AcceptAndMakePaymentResult = {
  subscriptionPayment: damlTypes.ContractId<SubscriptionInitialPayment>;
  senderChange: damlTypes.Optional<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const SubscriptionRequest_AcceptAndMakePaymentResult:
  damlTypes.Serializable<SubscriptionRequest_AcceptAndMakePaymentResult> & {
  }
;


export declare type Subscription_ArchiveResult = {
  terminatedSubscription: damlTypes.ContractId<TerminatedSubscription>;
};

export declare const Subscription_ArchiveResult:
  damlTypes.Serializable<Subscription_ArchiveResult> & {
  }
;


export declare type SubscriptionData = {
  sender: damlTypes.Party;
  receiver: damlTypes.Party;
  provider: damlTypes.Party;
  dso: damlTypes.Party;
  description: string;
};

export declare const SubscriptionData:
  damlTypes.Serializable<SubscriptionData> & {
  }
;

