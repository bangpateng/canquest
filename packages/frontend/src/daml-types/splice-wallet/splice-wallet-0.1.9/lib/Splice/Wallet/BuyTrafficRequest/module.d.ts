// Generated from Splice/Wallet/BuyTrafficRequest.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 from '@daml.js/splice-amulet-0.1.9';

export declare type BuyTrafficRequest_Expire = {
};

export declare const BuyTrafficRequest_Expire:
  damlTypes.Serializable<BuyTrafficRequest_Expire> & {
  }
;


export declare type BuyTrafficRequest_Cancel = {
  reason: string;
};

export declare const BuyTrafficRequest_Cancel:
  damlTypes.Serializable<BuyTrafficRequest_Cancel> & {
  }
;


export declare type BuyTrafficRequest_Complete = {
  inputs: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput[];
  context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext;
  walletProvider: damlTypes.Party;
};

export declare const BuyTrafficRequest_Complete:
  damlTypes.Serializable<BuyTrafficRequest_Complete> & {
  }
;


export declare type BuyTrafficRequest = {
  dso: damlTypes.Party;
  endUserParty: damlTypes.Party;
  expiresAt: damlTypes.Time;
  trackingId: string;
  trafficAmount: damlTypes.Int;
  memberId: string;
  synchronizerId: string;
  migrationId: damlTypes.Int;
};

export declare interface BuyTrafficRequestInterface {
  BuyTrafficRequest_Complete: damlTypes.Choice<BuyTrafficRequest, BuyTrafficRequest_Complete, BuyTrafficRequest_CompleteResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<BuyTrafficRequest, undefined>>;
  BuyTrafficRequest_Cancel: damlTypes.Choice<BuyTrafficRequest, BuyTrafficRequest_Cancel, BuyTrafficRequest_CancelResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<BuyTrafficRequest, undefined>>;
  Archive: damlTypes.Choice<BuyTrafficRequest, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<BuyTrafficRequest, undefined>>;
  BuyTrafficRequest_Expire: damlTypes.Choice<BuyTrafficRequest, BuyTrafficRequest_Expire, BuyTrafficRequest_ExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<BuyTrafficRequest, undefined>>;
}
export declare const BuyTrafficRequest:
  damlTypes.Template<BuyTrafficRequest, undefined, '#splice-wallet:Splice.Wallet.BuyTrafficRequest:BuyTrafficRequest'> &
  damlTypes.ToInterface<BuyTrafficRequest, never> &
  BuyTrafficRequestInterface;

export declare namespace BuyTrafficRequest {
}



export declare type BuyTrafficRequest_ExpireResult = {
  trackingInfo: BuyTrafficRequestTrackingInfo;
};

export declare const BuyTrafficRequest_ExpireResult:
  damlTypes.Serializable<BuyTrafficRequest_ExpireResult> & {
  }
;


export declare type BuyTrafficRequest_CancelResult = {
  trackingInfo: BuyTrafficRequestTrackingInfo;
};

export declare const BuyTrafficRequest_CancelResult:
  damlTypes.Serializable<BuyTrafficRequest_CancelResult> & {
  }
;


export declare type BuyTrafficRequest_CompleteResult = {
  purchasedTraffic: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.DecentralizedSynchronizer.MemberTraffic>;
  trackingInfo: BuyTrafficRequestTrackingInfo;
  senderChangeAmulet: damlTypes.Optional<damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet>>;
};

export declare const BuyTrafficRequest_CompleteResult:
  damlTypes.Serializable<BuyTrafficRequest_CompleteResult> & {
  }
;


export declare type BuyTrafficRequestTrackingInfo = {
  trackingId: string;
  endUserParty: damlTypes.Party;
};

export declare const BuyTrafficRequestTrackingInfo:
  damlTypes.Serializable<BuyTrafficRequestTrackingInfo> & {
  }
;

