"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable-next-line no-unused-vars */
var jtv = require('@mojotech/json-type-validation');
/* eslint-disable-next-line no-unused-vars */
var damlTypes = require('@daml/types');

var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 = require('@daml.js/splice-amulet-0.1.9');


exports.TransferPreapprovalProposal_AcceptResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferPreapprovalCid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).decoder, transferResult: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferResult.decoder, amuletPaid: damlTypes.Numeric(10).decoder, }); }),
  encode: function (__typed__) {
  return {
    transferPreapprovalCid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).encode(__typed__.transferPreapprovalCid),
    transferResult: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferResult.encode(__typed__.transferResult),
    amuletPaid: damlTypes.Numeric(10).encode(__typed__.amuletPaid),
  };
}
,
};



exports.TransferPreapprovalProposal_Accept = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.decoder, inputs: damlTypes.List(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput).decoder, expiresAt: damlTypes.Time.decoder, }); }),
  encode: function (__typed__) {
  return {
    context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.encode(__typed__.context),
    inputs: damlTypes.List(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput).encode(__typed__.inputs),
    expiresAt: damlTypes.Time.encode(__typed__.expiresAt),
  };
}
,
};



exports.TransferPreapprovalProposal = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet:Splice.Wallet.TransferPreapproval:TransferPreapprovalProposal',
  templateIdWithPackageId: '940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5:Splice.Wallet.TransferPreapproval:TransferPreapprovalProposal',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({receiver: damlTypes.Party.decoder, provider: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    receiver: damlTypes.Party.encode(__typed__.receiver),
    provider: damlTypes.Party.encode(__typed__.provider),
  };
}
,
  Archive: {
    template: function () { return exports.TransferPreapprovalProposal; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
  TransferPreapprovalProposal_Accept: {
    template: function () { return exports.TransferPreapprovalProposal; },
    choiceName: 'TransferPreapprovalProposal_Accept',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.TransferPreapprovalProposal_Accept.decoder; }),
    argumentEncode: function (__typed__) { return exports.TransferPreapprovalProposal_Accept.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.TransferPreapprovalProposal_AcceptResult.decoder; }),
    resultEncode: function (__typed__) { return exports.TransferPreapprovalProposal_AcceptResult.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.TransferPreapprovalProposal, ['940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5', '#splice-wallet']);

