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


exports.BuyTrafficRequest_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};



exports.BuyTrafficRequest_Cancel = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.BuyTrafficRequest_Complete = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({inputs: damlTypes.List(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput).decoder, context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.decoder, walletProvider: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    inputs: damlTypes.List(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput).encode(__typed__.inputs),
    context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.encode(__typed__.context),
    walletProvider: damlTypes.Party.encode(__typed__.walletProvider),
  };
}
,
};



exports.BuyTrafficRequest = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet:Splice.Wallet.BuyTrafficRequest:BuyTrafficRequest',
  templateIdWithPackageId: '940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5:Splice.Wallet.BuyTrafficRequest:BuyTrafficRequest',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({dso: damlTypes.Party.decoder, endUserParty: damlTypes.Party.decoder, expiresAt: damlTypes.Time.decoder, trackingId: damlTypes.Text.decoder, trafficAmount: damlTypes.Int.decoder, memberId: damlTypes.Text.decoder, synchronizerId: damlTypes.Text.decoder, migrationId: damlTypes.Int.decoder, }); }),
  encode: function (__typed__) {
  return {
    dso: damlTypes.Party.encode(__typed__.dso),
    endUserParty: damlTypes.Party.encode(__typed__.endUserParty),
    expiresAt: damlTypes.Time.encode(__typed__.expiresAt),
    trackingId: damlTypes.Text.encode(__typed__.trackingId),
    trafficAmount: damlTypes.Int.encode(__typed__.trafficAmount),
    memberId: damlTypes.Text.encode(__typed__.memberId),
    synchronizerId: damlTypes.Text.encode(__typed__.synchronizerId),
    migrationId: damlTypes.Int.encode(__typed__.migrationId),
  };
}
,
  BuyTrafficRequest_Complete: {
    template: function () { return exports.BuyTrafficRequest; },
    choiceName: 'BuyTrafficRequest_Complete',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.BuyTrafficRequest_Complete.decoder; }),
    argumentEncode: function (__typed__) { return exports.BuyTrafficRequest_Complete.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.BuyTrafficRequest_CompleteResult.decoder; }),
    resultEncode: function (__typed__) { return exports.BuyTrafficRequest_CompleteResult.encode(__typed__); },
  },
  BuyTrafficRequest_Cancel: {
    template: function () { return exports.BuyTrafficRequest; },
    choiceName: 'BuyTrafficRequest_Cancel',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.BuyTrafficRequest_Cancel.decoder; }),
    argumentEncode: function (__typed__) { return exports.BuyTrafficRequest_Cancel.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.BuyTrafficRequest_CancelResult.decoder; }),
    resultEncode: function (__typed__) { return exports.BuyTrafficRequest_CancelResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.BuyTrafficRequest; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
  BuyTrafficRequest_Expire: {
    template: function () { return exports.BuyTrafficRequest; },
    choiceName: 'BuyTrafficRequest_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.BuyTrafficRequest_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.BuyTrafficRequest_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.BuyTrafficRequest_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.BuyTrafficRequest_ExpireResult.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.BuyTrafficRequest, ['940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5', '#splice-wallet']);



exports.BuyTrafficRequest_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: exports.BuyTrafficRequestTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: exports.BuyTrafficRequestTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.BuyTrafficRequest_CancelResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: exports.BuyTrafficRequestTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: exports.BuyTrafficRequestTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.BuyTrafficRequest_CompleteResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({purchasedTraffic: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.DecentralizedSynchronizer.MemberTraffic).decoder, trackingInfo: exports.BuyTrafficRequestTrackingInfo.decoder, senderChangeAmulet: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder), }); }),
  encode: function (__typed__) {
  return {
    purchasedTraffic: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.DecentralizedSynchronizer.MemberTraffic).encode(__typed__.purchasedTraffic),
    trackingInfo: exports.BuyTrafficRequestTrackingInfo.encode(__typed__.trackingInfo),
    senderChangeAmulet: damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.senderChangeAmulet),
  };
}
,
};



exports.BuyTrafficRequestTrackingInfo = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingId: damlTypes.Text.decoder, endUserParty: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingId: damlTypes.Text.encode(__typed__.trackingId),
    endUserParty: damlTypes.Party.encode(__typed__.endUserParty),
  };
}
,
};

