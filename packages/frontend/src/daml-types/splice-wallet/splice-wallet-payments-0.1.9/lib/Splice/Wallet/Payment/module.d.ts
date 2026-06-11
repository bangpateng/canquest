// Generated from Splice/Wallet/Payment.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4 from '@daml.js/daml-prim-DA-Types-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 from '@daml.js/splice-amulet-0.1.9';

export declare type AcceptedAppPayment_Expire = {
  context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext;
};

export declare const AcceptedAppPayment_Expire:
  damlTypes.Serializable<AcceptedAppPayment_Expire> & {
  }
;


export declare type AcceptedAppPayment_Reject = {
  context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext;
};

export declare const AcceptedAppPayment_Reject:
  damlTypes.Serializable<AcceptedAppPayment_Reject> & {
  }
;


export declare type AcceptedAppPayment_Collect = {
  context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext;
};

export declare const AcceptedAppPayment_Collect:
  damlTypes.Serializable<AcceptedAppPayment_Collect> & {
  }
;


export declare type AcceptedAppPayment = {
  sender: damlTypes.Party;
  amuletReceiverAmounts: ReceiverAmuletAmount[];
  provider: damlTypes.Party;
  dso: damlTypes.Party;
  lockedAmulet: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet>;
  round: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Types.Round;
  reference: damlTypes.ContractId<AppPaymentRequest>;
};

export declare interface AcceptedAppPaymentInterface {
  Archive: damlTypes.Choice<AcceptedAppPayment, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AcceptedAppPayment, undefined>>;
  AcceptedAppPayment_Collect: damlTypes.Choice<AcceptedAppPayment, AcceptedAppPayment_Collect, AcceptedAppPayment_CollectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AcceptedAppPayment, undefined>>;
  AcceptedAppPayment_Expire: damlTypes.Choice<AcceptedAppPayment, AcceptedAppPayment_Expire, AcceptedAppPayment_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AcceptedAppPayment, undefined>>;
  AcceptedAppPayment_Reject: damlTypes.Choice<AcceptedAppPayment, AcceptedAppPayment_Reject, AcceptedAppPayment_RejectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AcceptedAppPayment, undefined>>;
}
export declare const AcceptedAppPayment:
  damlTypes.Template<AcceptedAppPayment, undefined, '#splice-wallet-payments:Splice.Wallet.Payment:AcceptedAppPayment'> &
  damlTypes.ToInterface<AcceptedAppPayment, never> &
  AcceptedAppPaymentInterface;

export declare namespace AcceptedAppPayment {
}



export declare type AcceptedAppPayment_CollectResult = {
  receiverAmulets: pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2<damlTypes.Party, damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>[];
};

export declare const AcceptedAppPayment_CollectResult:
  damlTypes.Serializable<AcceptedAppPayment_CollectResult> & {
  }
;


export declare type ReceiverAmulet = {
  receiver: damlTypes.Party;
  lockedAmulet: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet>;
};

export declare const ReceiverAmulet:
  damlTypes.Serializable<ReceiverAmulet> & {
  }
;


export declare type TerminatedAppPayment = {
  sender: damlTypes.Party;
  provider: damlTypes.Party;
  receivers: damlTypes.Party[];
  reference: damlTypes.ContractId<AppPaymentRequest>;
};

export declare interface TerminatedAppPaymentInterface {
  Archive: damlTypes.Choice<TerminatedAppPayment, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<TerminatedAppPayment, undefined>>;
}
export declare const TerminatedAppPayment:
  damlTypes.Template<TerminatedAppPayment, undefined, '#splice-wallet-payments:Splice.Wallet.Payment:TerminatedAppPayment'> &
  damlTypes.ToInterface<TerminatedAppPayment, never> &
  TerminatedAppPaymentInterface;

export declare namespace TerminatedAppPayment {
}



export declare type AppPaymentRequest_Reject = {
};

export declare const AppPaymentRequest_Reject:
  damlTypes.Serializable<AppPaymentRequest_Reject> & {
  }
;


export declare type AppPaymentRequest_Withdraw = {
};

export declare const AppPaymentRequest_Withdraw:
  damlTypes.Serializable<AppPaymentRequest_Withdraw> & {
  }
;


export declare type AppPaymentRequest_Accept = {
  inputs: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput[];
  context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext;
  walletProvider: damlTypes.Party;
};

export declare const AppPaymentRequest_Accept:
  damlTypes.Serializable<AppPaymentRequest_Accept> & {
  }
;


export declare type AppPaymentRequest_Expire = {
  actor: damlTypes.Party;
};

export declare const AppPaymentRequest_Expire:
  damlTypes.Serializable<AppPaymentRequest_Expire> & {
  }
;


export declare type AppPaymentRequest = {
  sender: damlTypes.Party;
  receiverAmounts: ReceiverAmount[];
  provider: damlTypes.Party;
  dso: damlTypes.Party;
  expiresAt: damlTypes.Time;
  description: string;
};

export declare interface AppPaymentRequestInterface {
  AppPaymentRequest_Accept: damlTypes.Choice<AppPaymentRequest, AppPaymentRequest_Accept, AppPaymentRequest_AcceptResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AppPaymentRequest, undefined>>;
  AppPaymentRequest_Expire: damlTypes.Choice<AppPaymentRequest, AppPaymentRequest_Expire, AppPaymentRequest_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AppPaymentRequest, undefined>>;
  AppPaymentRequest_Reject: damlTypes.Choice<AppPaymentRequest, AppPaymentRequest_Reject, AppPaymentRequest_RejectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AppPaymentRequest, undefined>>;
  Archive: damlTypes.Choice<AppPaymentRequest, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AppPaymentRequest, undefined>>;
  AppPaymentRequest_Withdraw: damlTypes.Choice<AppPaymentRequest, AppPaymentRequest_Withdraw, AppPaymentRequest_WithdrawResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AppPaymentRequest, undefined>>;
}
export declare const AppPaymentRequest:
  damlTypes.Template<AppPaymentRequest, undefined, '#splice-wallet-payments:Splice.Wallet.Payment:AppPaymentRequest'> &
  damlTypes.ToInterface<AppPaymentRequest, never> &
  AppPaymentRequestInterface;

export declare namespace AppPaymentRequest {
}



export declare type ReceiverAmuletAmount = {
  receiver: damlTypes.Party;
  amuletAmount: damlTypes.Numeric;
};

export declare const ReceiverAmuletAmount:
  damlTypes.Serializable<ReceiverAmuletAmount> & {
  }
;


export declare type ReceiverAmount = {
  receiver: damlTypes.Party;
  amount: PaymentAmount;
};

export declare const ReceiverAmount:
  damlTypes.Serializable<ReceiverAmount> & {
  }
;


export declare type PaymentAmount = {
  amount: damlTypes.Numeric;
  unit: Unit;
};

export declare const PaymentAmount:
  damlTypes.Serializable<PaymentAmount> & {
  }
;


export declare type AcceptedAppPayment_ExpireResult = {
  amulet: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const AcceptedAppPayment_ExpireResult:
  damlTypes.Serializable<AcceptedAppPayment_ExpireResult> & {
  }
;


export declare type AcceptedAppPayment_RejectResult = {
  amulet: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const AcceptedAppPayment_RejectResult:
  damlTypes.Serializable<AcceptedAppPayment_RejectResult> & {
  }
;


export declare type AppPaymentRequest_RejectResult = {
  terminatedAppPayment: damlTypes.ContractId<TerminatedAppPayment>;
};

export declare const AppPaymentRequest_RejectResult:
  damlTypes.Serializable<AppPaymentRequest_RejectResult> & {
  }
;


export declare type AppPaymentRequest_WithdrawResult = {
  terminatedAppPayment: damlTypes.ContractId<TerminatedAppPayment>;
};

export declare const AppPaymentRequest_WithdrawResult:
  damlTypes.Serializable<AppPaymentRequest_WithdrawResult> & {
  }
;


export declare type AppPaymentRequest_AcceptResult = {
  acceptedPayment: damlTypes.ContractId<AcceptedAppPayment>;
  senderChangeAmulet: damlTypes.Optional<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const AppPaymentRequest_AcceptResult:
  damlTypes.Serializable<AppPaymentRequest_AcceptResult> & {
  }
;


export declare type AppPaymentRequest_ExpireResult = {
  terminatedAppPayment: damlTypes.ContractId<TerminatedAppPayment>;
};

export declare const AppPaymentRequest_ExpireResult:
  damlTypes.Serializable<AppPaymentRequest_ExpireResult> & {
  }
;


export declare type Unit =
  | 'USDUnit'
  | 'AmuletUnit'
  | 'ExtUnit'
;

export declare const Unit:
  damlTypes.Serializable<Unit> & {
  }
& { readonly keys: Unit[] } & { readonly [e in Unit]: e }
;

