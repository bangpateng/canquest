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

var pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7 = require('@daml.js/splice-wallet-payments-0.1.9');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 = require('@daml.js/splice-amulet-0.1.9');


exports.AcceptedTransferOffer_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({actor: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    actor: damlTypes.Party.encode(__typed__.actor),
  };
}
,
};



exports.AcceptedTransferOffer_Abort = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.AcceptedTransferOffer_Withdraw = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.AcceptedTransferOffer_Complete = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({inputs: damlTypes.List(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput).decoder, transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.decoder, walletProvider: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    inputs: damlTypes.List(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput).encode(__typed__.inputs),
    transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.encode(__typed__.transferContext),
    walletProvider: damlTypes.Party.encode(__typed__.walletProvider),
  };
}
,
};



exports.AcceptedTransferOffer = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet:Splice.Wallet.TransferOffer:AcceptedTransferOffer',
  templateIdWithPackageId: '940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5:Splice.Wallet.TransferOffer:AcceptedTransferOffer',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({sender: damlTypes.Party.decoder, receiver: damlTypes.Party.decoder, dso: damlTypes.Party.decoder, amount: pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.PaymentAmount.decoder, expiresAt: damlTypes.Time.decoder, trackingId: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    sender: damlTypes.Party.encode(__typed__.sender),
    receiver: damlTypes.Party.encode(__typed__.receiver),
    dso: damlTypes.Party.encode(__typed__.dso),
    amount: pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.PaymentAmount.encode(__typed__.amount),
    expiresAt: damlTypes.Time.encode(__typed__.expiresAt),
    trackingId: damlTypes.Text.encode(__typed__.trackingId),
  };
}
,
  AcceptedTransferOffer_Complete: {
    template: function () { return exports.AcceptedTransferOffer; },
    choiceName: 'AcceptedTransferOffer_Complete',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedTransferOffer_Complete.decoder; }),
    argumentEncode: function (__typed__) { return exports.AcceptedTransferOffer_Complete.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedTransferOffer_CompleteResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AcceptedTransferOffer_CompleteResult.encode(__typed__); },
  },
  AcceptedTransferOffer_Withdraw: {
    template: function () { return exports.AcceptedTransferOffer; },
    choiceName: 'AcceptedTransferOffer_Withdraw',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedTransferOffer_Withdraw.decoder; }),
    argumentEncode: function (__typed__) { return exports.AcceptedTransferOffer_Withdraw.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedTransferOffer_WithdrawResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AcceptedTransferOffer_WithdrawResult.encode(__typed__); },
  },
  AcceptedTransferOffer_Abort: {
    template: function () { return exports.AcceptedTransferOffer; },
    choiceName: 'AcceptedTransferOffer_Abort',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedTransferOffer_Abort.decoder; }),
    argumentEncode: function (__typed__) { return exports.AcceptedTransferOffer_Abort.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedTransferOffer_AbortResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AcceptedTransferOffer_AbortResult.encode(__typed__); },
  },
  AcceptedTransferOffer_Expire: {
    template: function () { return exports.AcceptedTransferOffer; },
    choiceName: 'AcceptedTransferOffer_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedTransferOffer_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.AcceptedTransferOffer_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedTransferOffer_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AcceptedTransferOffer_ExpireResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.AcceptedTransferOffer; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.AcceptedTransferOffer, ['940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5', '#splice-wallet']);



exports.AcceptedTransferOffer_CompleteResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferResult: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferResult.decoder, trackingInfo: exports.TransferOfferTrackingInfo.decoder, senderChangeAmulet: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder), }); }),
  encode: function (__typed__) {
  return {
    transferResult: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferResult.encode(__typed__.transferResult),
    trackingInfo: exports.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
    senderChangeAmulet: damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.senderChangeAmulet),
  };
}
,
};



exports.TransferOfferTrackingInfo = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingId: damlTypes.Text.decoder, sender: damlTypes.Party.decoder, receiver: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingId: damlTypes.Text.encode(__typed__.trackingId),
    sender: damlTypes.Party.encode(__typed__.sender),
    receiver: damlTypes.Party.encode(__typed__.receiver),
  };
}
,
};



exports.TransferOffer_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({actor: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    actor: damlTypes.Party.encode(__typed__.actor),
  };
}
,
};



exports.TransferOffer_Withdraw = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.TransferOffer_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};



exports.TransferOffer_Accept = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};



exports.TransferOffer = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet:Splice.Wallet.TransferOffer:TransferOffer',
  templateIdWithPackageId: '940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5:Splice.Wallet.TransferOffer:TransferOffer',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({sender: damlTypes.Party.decoder, receiver: damlTypes.Party.decoder, dso: damlTypes.Party.decoder, amount: pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.PaymentAmount.decoder, description: damlTypes.Text.decoder, expiresAt: damlTypes.Time.decoder, trackingId: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    sender: damlTypes.Party.encode(__typed__.sender),
    receiver: damlTypes.Party.encode(__typed__.receiver),
    dso: damlTypes.Party.encode(__typed__.dso),
    amount: pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.PaymentAmount.encode(__typed__.amount),
    description: damlTypes.Text.encode(__typed__.description),
    expiresAt: damlTypes.Time.encode(__typed__.expiresAt),
    trackingId: damlTypes.Text.encode(__typed__.trackingId),
  };
}
,
  TransferOffer_Accept: {
    template: function () { return exports.TransferOffer; },
    choiceName: 'TransferOffer_Accept',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.TransferOffer_Accept.decoder; }),
    argumentEncode: function (__typed__) { return exports.TransferOffer_Accept.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.TransferOffer_AcceptResult.decoder; }),
    resultEncode: function (__typed__) { return exports.TransferOffer_AcceptResult.encode(__typed__); },
  },
  TransferOffer_Reject: {
    template: function () { return exports.TransferOffer; },
    choiceName: 'TransferOffer_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.TransferOffer_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.TransferOffer_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.TransferOffer_RejectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.TransferOffer_RejectResult.encode(__typed__); },
  },
  TransferOffer_Withdraw: {
    template: function () { return exports.TransferOffer; },
    choiceName: 'TransferOffer_Withdraw',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.TransferOffer_Withdraw.decoder; }),
    argumentEncode: function (__typed__) { return exports.TransferOffer_Withdraw.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.TransferOffer_WithdrawResult.decoder; }),
    resultEncode: function (__typed__) { return exports.TransferOffer_WithdrawResult.encode(__typed__); },
  },
  TransferOffer_Expire: {
    template: function () { return exports.TransferOffer; },
    choiceName: 'TransferOffer_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.TransferOffer_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.TransferOffer_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.TransferOffer_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.TransferOffer_ExpireResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.TransferOffer; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.TransferOffer, ['940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5', '#splice-wallet']);



exports.AcceptedTransferOffer_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: exports.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: exports.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.AcceptedTransferOffer_AbortResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: exports.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: exports.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.AcceptedTransferOffer_WithdrawResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: exports.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: exports.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.TransferOffer_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: exports.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: exports.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.TransferOffer_WithdrawResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: exports.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: exports.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.TransferOffer_RejectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: exports.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: exports.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.TransferOffer_AcceptResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({acceptedTransferOffer: damlTypes.ContractId(exports.AcceptedTransferOffer).decoder, }); }),
  encode: function (__typed__) {
  return {
    acceptedTransferOffer: damlTypes.ContractId(exports.AcceptedTransferOffer).encode(__typed__.acceptedTransferOffer),
  };
}
,
};

