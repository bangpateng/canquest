// Generated from Splice/Wallet/TransferPreapproval.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
import * as pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 from '@daml.js/splice-amulet-0.1.9';

export declare type TransferPreapprovalProposal_AcceptResult = {
  transferPreapprovalCid: damlTypes.ContractId<pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval>;
  transferResult: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferResult;
  amuletPaid: damlTypes.Numeric;
};

export declare const TransferPreapprovalProposal_AcceptResult:
  damlTypes.Serializable<TransferPreapprovalProposal_AcceptResult> & {
  }
;


export declare type TransferPreapprovalProposal_Accept = {
  context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext;
  inputs: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput[];
  expiresAt: damlTypes.Time;
};

export declare const TransferPreapprovalProposal_Accept:
  damlTypes.Serializable<TransferPreapprovalProposal_Accept> & {
  }
;


export declare type TransferPreapprovalProposal = {
  receiver: damlTypes.Party;
  provider: damlTypes.Party;
};

export declare interface TransferPreapprovalProposalInterface {
  Archive: damlTypes.Choice<TransferPreapprovalProposal, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<TransferPreapprovalProposal, undefined>>;
  TransferPreapprovalProposal_Accept: damlTypes.Choice<TransferPreapprovalProposal, TransferPreapprovalProposal_Accept, TransferPreapprovalProposal_AcceptResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<TransferPreapprovalProposal, undefined>>;
}
export declare const TransferPreapprovalProposal:
  damlTypes.Template<TransferPreapprovalProposal, undefined, '#splice-wallet:Splice.Wallet.TransferPreapproval:TransferPreapprovalProposal'> &
  damlTypes.ToInterface<TransferPreapprovalProposal, never> &
  TransferPreapprovalProposalInterface;

export declare namespace TransferPreapprovalProposal {
}


