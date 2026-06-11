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

var pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4 = require('@daml.js/daml-prim-DA-Types-1.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 = require('@daml.js/splice-amulet-0.1.9');


exports.AcceptedAppPayment_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.encode(__typed__.context),
  };
}
,
};



exports.AcceptedAppPayment_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.encode(__typed__.context),
  };
}
,
};



exports.AcceptedAppPayment_Collect = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.encode(__typed__.context),
  };
}
,
};



exports.AcceptedAppPayment = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet-payments:Splice.Wallet.Payment:AcceptedAppPayment',
  templateIdWithPackageId: '7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7:Splice.Wallet.Payment:AcceptedAppPayment',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({sender: damlTypes.Party.decoder, amuletReceiverAmounts: damlTypes.List(exports.ReceiverAmuletAmount).decoder, provider: damlTypes.Party.decoder, dso: damlTypes.Party.decoder, lockedAmulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet).decoder, round: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Types.Round.decoder, reference: damlTypes.ContractId(exports.AppPaymentRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    sender: damlTypes.Party.encode(__typed__.sender),
    amuletReceiverAmounts: damlTypes.List(exports.ReceiverAmuletAmount).encode(__typed__.amuletReceiverAmounts),
    provider: damlTypes.Party.encode(__typed__.provider),
    dso: damlTypes.Party.encode(__typed__.dso),
    lockedAmulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet).encode(__typed__.lockedAmulet),
    round: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Types.Round.encode(__typed__.round),
    reference: damlTypes.ContractId(exports.AppPaymentRequest).encode(__typed__.reference),
  };
}
,
  Archive: {
    template: function () { return exports.AcceptedAppPayment; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
  AcceptedAppPayment_Collect: {
    template: function () { return exports.AcceptedAppPayment; },
    choiceName: 'AcceptedAppPayment_Collect',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedAppPayment_Collect.decoder; }),
    argumentEncode: function (__typed__) { return exports.AcceptedAppPayment_Collect.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedAppPayment_CollectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AcceptedAppPayment_CollectResult.encode(__typed__); },
  },
  AcceptedAppPayment_Expire: {
    template: function () { return exports.AcceptedAppPayment; },
    choiceName: 'AcceptedAppPayment_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedAppPayment_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.AcceptedAppPayment_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedAppPayment_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AcceptedAppPayment_ExpireResult.encode(__typed__); },
  },
  AcceptedAppPayment_Reject: {
    template: function () { return exports.AcceptedAppPayment; },
    choiceName: 'AcceptedAppPayment_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedAppPayment_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.AcceptedAppPayment_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AcceptedAppPayment_RejectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AcceptedAppPayment_RejectResult.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.AcceptedAppPayment, ['7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7', '#splice-wallet-payments']);



exports.AcceptedAppPayment_CollectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({receiverAmulets: damlTypes.List(pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(damlTypes.Party, damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet))).decoder, }); }),
  encode: function (__typed__) {
  return {
    receiverAmulets: damlTypes.List(pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(damlTypes.Party, damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet))).encode(__typed__.receiverAmulets),
  };
}
,
};



exports.ReceiverAmulet = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({receiver: damlTypes.Party.decoder, lockedAmulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet).decoder, }); }),
  encode: function (__typed__) {
  return {
    receiver: damlTypes.Party.encode(__typed__.receiver),
    lockedAmulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet).encode(__typed__.lockedAmulet),
  };
}
,
};



exports.TerminatedAppPayment = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet-payments:Splice.Wallet.Payment:TerminatedAppPayment',
  templateIdWithPackageId: '7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7:Splice.Wallet.Payment:TerminatedAppPayment',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({sender: damlTypes.Party.decoder, provider: damlTypes.Party.decoder, receivers: damlTypes.List(damlTypes.Party).decoder, reference: damlTypes.ContractId(exports.AppPaymentRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    sender: damlTypes.Party.encode(__typed__.sender),
    provider: damlTypes.Party.encode(__typed__.provider),
    receivers: damlTypes.List(damlTypes.Party).encode(__typed__.receivers),
    reference: damlTypes.ContractId(exports.AppPaymentRequest).encode(__typed__.reference),
  };
}
,
  Archive: {
    template: function () { return exports.TerminatedAppPayment; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.TerminatedAppPayment, ['7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7', '#splice-wallet-payments']);



exports.AppPaymentRequest_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};



exports.AppPaymentRequest_Withdraw = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};



exports.AppPaymentRequest_Accept = {
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



exports.AppPaymentRequest_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({actor: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    actor: damlTypes.Party.encode(__typed__.actor),
  };
}
,
};



exports.AppPaymentRequest = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet-payments:Splice.Wallet.Payment:AppPaymentRequest',
  templateIdWithPackageId: '7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7:Splice.Wallet.Payment:AppPaymentRequest',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({sender: damlTypes.Party.decoder, receiverAmounts: damlTypes.List(exports.ReceiverAmount).decoder, provider: damlTypes.Party.decoder, dso: damlTypes.Party.decoder, expiresAt: damlTypes.Time.decoder, description: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    sender: damlTypes.Party.encode(__typed__.sender),
    receiverAmounts: damlTypes.List(exports.ReceiverAmount).encode(__typed__.receiverAmounts),
    provider: damlTypes.Party.encode(__typed__.provider),
    dso: damlTypes.Party.encode(__typed__.dso),
    expiresAt: damlTypes.Time.encode(__typed__.expiresAt),
    description: damlTypes.Text.encode(__typed__.description),
  };
}
,
  AppPaymentRequest_Accept: {
    template: function () { return exports.AppPaymentRequest; },
    choiceName: 'AppPaymentRequest_Accept',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AppPaymentRequest_Accept.decoder; }),
    argumentEncode: function (__typed__) { return exports.AppPaymentRequest_Accept.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AppPaymentRequest_AcceptResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AppPaymentRequest_AcceptResult.encode(__typed__); },
  },
  AppPaymentRequest_Expire: {
    template: function () { return exports.AppPaymentRequest; },
    choiceName: 'AppPaymentRequest_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AppPaymentRequest_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.AppPaymentRequest_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AppPaymentRequest_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AppPaymentRequest_ExpireResult.encode(__typed__); },
  },
  AppPaymentRequest_Reject: {
    template: function () { return exports.AppPaymentRequest; },
    choiceName: 'AppPaymentRequest_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AppPaymentRequest_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.AppPaymentRequest_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AppPaymentRequest_RejectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AppPaymentRequest_RejectResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.AppPaymentRequest; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
  AppPaymentRequest_Withdraw: {
    template: function () { return exports.AppPaymentRequest; },
    choiceName: 'AppPaymentRequest_Withdraw',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AppPaymentRequest_Withdraw.decoder; }),
    argumentEncode: function (__typed__) { return exports.AppPaymentRequest_Withdraw.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AppPaymentRequest_WithdrawResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AppPaymentRequest_WithdrawResult.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.AppPaymentRequest, ['7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7', '#splice-wallet-payments']);



exports.ReceiverAmuletAmount = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({receiver: damlTypes.Party.decoder, amuletAmount: damlTypes.Numeric(10).decoder, }); }),
  encode: function (__typed__) {
  return {
    receiver: damlTypes.Party.encode(__typed__.receiver),
    amuletAmount: damlTypes.Numeric(10).encode(__typed__.amuletAmount),
  };
}
,
};



exports.ReceiverAmount = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({receiver: damlTypes.Party.decoder, amount: exports.PaymentAmount.decoder, }); }),
  encode: function (__typed__) {
  return {
    receiver: damlTypes.Party.encode(__typed__.receiver),
    amount: exports.PaymentAmount.encode(__typed__.amount),
  };
}
,
};



exports.PaymentAmount = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({amount: damlTypes.Numeric(10).decoder, unit: exports.Unit.decoder, }); }),
  encode: function (__typed__) {
  return {
    amount: damlTypes.Numeric(10).encode(__typed__.amount),
    unit: exports.Unit.encode(__typed__.unit),
  };
}
,
};



exports.AcceptedAppPayment_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({amulet: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder, }); }),
  encode: function (__typed__) {
  return {
    amulet: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.amulet),
  };
}
,
};



exports.AcceptedAppPayment_RejectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({amulet: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder, }); }),
  encode: function (__typed__) {
  return {
    amulet: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.amulet),
  };
}
,
};



exports.AppPaymentRequest_RejectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedAppPayment: damlTypes.ContractId(exports.TerminatedAppPayment).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedAppPayment: damlTypes.ContractId(exports.TerminatedAppPayment).encode(__typed__.terminatedAppPayment),
  };
}
,
};



exports.AppPaymentRequest_WithdrawResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedAppPayment: damlTypes.ContractId(exports.TerminatedAppPayment).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedAppPayment: damlTypes.ContractId(exports.TerminatedAppPayment).encode(__typed__.terminatedAppPayment),
  };
}
,
};



exports.AppPaymentRequest_AcceptResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({acceptedPayment: damlTypes.ContractId(exports.AcceptedAppPayment).decoder, senderChangeAmulet: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder), }); }),
  encode: function (__typed__) {
  return {
    acceptedPayment: damlTypes.ContractId(exports.AcceptedAppPayment).encode(__typed__.acceptedPayment),
    senderChangeAmulet: damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.senderChangeAmulet),
  };
}
,
};



exports.AppPaymentRequest_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedAppPayment: damlTypes.ContractId(exports.TerminatedAppPayment).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedAppPayment: damlTypes.ContractId(exports.TerminatedAppPayment).encode(__typed__.terminatedAppPayment),
  };
}
,
};



exports.Unit = {
  USDUnit: 'USDUnit',
  AmuletUnit: 'AmuletUnit',
  ExtUnit: 'ExtUnit',
  keys: ['USDUnit','AmuletUnit','ExtUnit',],
  decoder: damlTypes.lazyMemo(function () { return jtv.oneOf(jtv.constant(exports.Unit.USDUnit), jtv.constant(exports.Unit.AmuletUnit), jtv.constant(exports.Unit.ExtUnit)); }),
  encode: function (__typed__) { return __typed__; },
};

