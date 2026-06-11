// Generated from Splice/Wallet/TransferOffer.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7 from '@daml.js/splice-wallet-payments-0.1.9';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 from '@daml.js/splice-amulet-0.1.9';

export declare type AcceptedTransferOffer_Expire = {
  actor: damlTypes.Party;
};

export declare const AcceptedTransferOffer_Expire:
  damlTypes.Serializable<AcceptedTransferOffer_Expire> & {
  }
;


export declare type AcceptedTransferOffer_Abort = {
  reason: string;
};

export declare const AcceptedTransferOffer_Abort:
  damlTypes.Serializable<AcceptedTransferOffer_Abort> & {
  }
;


export declare type AcceptedTransferOffer_Withdraw = {
  reason: string;
};

export declare const AcceptedTransferOffer_Withdraw:
  damlTypes.Serializable<AcceptedTransferOffer_Withdraw> & {
  }
;


export declare type AcceptedTransferOffer_Complete = {
  inputs: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput[];
  transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext;
  walletProvider: damlTypes.Party;
};

export declare const AcceptedTransferOffer_Complete:
  damlTypes.Serializable<AcceptedTransferOffer_Complete> & {
  }
;


export declare type AcceptedTransferOffer = {
  sender: damlTypes.Party;
  receiver: damlTypes.Party;
  dso: damlTypes.Party;
  amount: pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.PaymentAmount;
  expiresAt: damlTypes.Time;
  trackingId: string;
};

export declare interface AcceptedTransferOfferInterface {
  AcceptedTransferOffer_Complete: damlTypes.Choice<AcceptedTransferOffer, AcceptedTransferOffer_Complete, AcceptedTransferOffer_CompleteResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AcceptedTransferOffer, undefined>>;
  AcceptedTransferOffer_Withdraw: damlTypes.Choice<AcceptedTransferOffer, AcceptedTransferOffer_Withdraw, AcceptedTransferOffer_WithdrawResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AcceptedTransferOffer, undefined>>;
  AcceptedTransferOffer_Abort: damlTypes.Choice<AcceptedTransferOffer, AcceptedTransferOffer_Abort, AcceptedTransferOffer_AbortResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AcceptedTransferOffer, undefined>>;
  AcceptedTransferOffer_Expire: damlTypes.Choice<AcceptedTransferOffer, AcceptedTransferOffer_Expire, AcceptedTransferOffer_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AcceptedTransferOffer, undefined>>;
  Archive: damlTypes.Choice<AcceptedTransferOffer, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AcceptedTransferOffer, undefined>>;
}
export declare const AcceptedTransferOffer:
  damlTypes.Template<AcceptedTransferOffer, undefined, '#splice-wallet:Splice.Wallet.TransferOffer:AcceptedTransferOffer'> &
  damlTypes.ToInterface<AcceptedTransferOffer, never> &
  AcceptedTransferOfferInterface;

export declare namespace AcceptedTransferOffer {
}



export declare type AcceptedTransferOffer_CompleteResult = {
  transferResult: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferResult;
  trackingInfo: TransferOfferTrackingInfo;
  senderChangeAmulet: damlTypes.Optional<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const AcceptedTransferOffer_CompleteResult:
  damlTypes.Serializable<AcceptedTransferOffer_CompleteResult> & {
  }
;


export declare type TransferOfferTrackingInfo = {
  trackingId: string;
  sender: damlTypes.Party;
  receiver: damlTypes.Party;
};

export declare const TransferOfferTrackingInfo:
  damlTypes.Serializable<TransferOfferTrackingInfo> & {
  }
;


export declare type TransferOffer_Expire = {
  actor: damlTypes.Party;
};

export declare const TransferOffer_Expire:
  damlTypes.Serializable<TransferOffer_Expire> & {
  }
;


export declare type TransferOffer_Withdraw = {
  reason: string;
};

export declare const TransferOffer_Withdraw:
  damlTypes.Serializable<TransferOffer_Withdraw> & {
  }
;


export declare type TransferOffer_Reject = {
};

export declare const TransferOffer_Reject:
  damlTypes.Serializable<TransferOffer_Reject> & {
  }
;


export declare type TransferOffer_Accept = {
};

export declare const TransferOffer_Accept:
  damlTypes.Serializable<TransferOffer_Accept> & {
  }
;


export declare type TransferOffer = {
  sender: damlTypes.Party;
  receiver: damlTypes.Party;
  dso: damlTypes.Party;
  amount: pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.PaymentAmount;
  description: string;
  expiresAt: damlTypes.Time;
  trackingId: string;
};

export declare interface TransferOfferInterface {
  TransferOffer_Accept: damlTypes.Choice<TransferOffer, TransferOffer_Accept, TransferOffer_AcceptResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<TransferOffer, undefined>>;
  TransferOffer_Reject: damlTypes.Choice<TransferOffer, TransferOffer_Reject, TransferOffer_RejectResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<TransferOffer, undefined>>;
  TransferOffer_Withdraw: damlTypes.Choice<TransferOffer, TransferOffer_Withdraw, TransferOffer_WithdrawResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<TransferOffer, undefined>>;
  TransferOffer_Expire: damlTypes.Choice<TransferOffer, TransferOffer_Expire, TransferOffer_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<TransferOffer, undefined>>;
  Archive: damlTypes.Choice<TransferOffer, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<TransferOffer, undefined>>;
}
export declare const TransferOffer:
  damlTypes.Template<TransferOffer, undefined, '#splice-wallet:Splice.Wallet.TransferOffer:TransferOffer'> &
  damlTypes.ToInterface<TransferOffer, never> &
  TransferOfferInterface;

export declare namespace TransferOffer {
}



export declare type AcceptedTransferOffer_ExpireResult = {
  trackingInfo: TransferOfferTrackingInfo;
};

export declare const AcceptedTransferOffer_ExpireResult:
  damlTypes.Serializable<AcceptedTransferOffer_ExpireResult> & {
  }
;


export declare type AcceptedTransferOffer_AbortResult = {
  trackingInfo: TransferOfferTrackingInfo;
};

export declare const AcceptedTransferOffer_AbortResult:
  damlTypes.Serializable<AcceptedTransferOffer_AbortResult> & {
  }
;


export declare type AcceptedTransferOffer_WithdrawResult = {
  trackingInfo: TransferOfferTrackingInfo;
};

export declare const AcceptedTransferOffer_WithdrawResult:
  damlTypes.Serializable<AcceptedTransferOffer_WithdrawResult> & {
  }
;


export declare type TransferOffer_ExpireResult = {
  trackingInfo: TransferOfferTrackingInfo;
};

export declare const TransferOffer_ExpireResult:
  damlTypes.Serializable<TransferOffer_ExpireResult> & {
  }
;


export declare type TransferOffer_WithdrawResult = {
  trackingInfo: TransferOfferTrackingInfo;
};

export declare const TransferOffer_WithdrawResult:
  damlTypes.Serializable<TransferOffer_WithdrawResult> & {
  }
;


export declare type TransferOffer_RejectResult = {
  trackingInfo: TransferOfferTrackingInfo;
};

export declare const TransferOffer_RejectResult:
  damlTypes.Serializable<TransferOffer_RejectResult> & {
  }
;


export declare type TransferOffer_AcceptResult = {
  acceptedTransferOffer: damlTypes.ContractId<AcceptedTransferOffer>;
};

export declare const TransferOffer_AcceptResult:
  damlTypes.Serializable<TransferOffer_AcceptResult> & {
  }
;

