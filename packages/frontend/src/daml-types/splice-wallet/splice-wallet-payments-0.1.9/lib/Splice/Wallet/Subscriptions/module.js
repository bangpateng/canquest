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
var pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946 = require('@daml.js/daml-stdlib-DA-Time-Types-1.0.0');

var Splice_Wallet_Payment = require('../../../Splice/Wallet/Payment/module');


exports.SubscriptionPayment_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({actor: damlTypes.Party.decoder, transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    actor: damlTypes.Party.encode(__typed__.actor),
    transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.encode(__typed__.transferContext),
  };
}
,
};



exports.SubscriptionPayment_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.encode(__typed__.transferContext),
  };
}
,
};



exports.SubscriptionPayment_Collect = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.encode(__typed__.transferContext),
  };
}
,
};



exports.SubscriptionPayment = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet-payments:Splice.Wallet.Subscriptions:SubscriptionPayment',
  templateIdWithPackageId: '7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7:Splice.Wallet.Subscriptions:SubscriptionPayment',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscription: damlTypes.ContractId(exports.Subscription).decoder, subscriptionData: exports.SubscriptionData.decoder, payData: exports.SubscriptionPayData.decoder, thisPaymentDueAt: damlTypes.Time.decoder, targetAmount: damlTypes.Numeric(10).decoder, lockedAmulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet).decoder, round: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Types.Round.decoder, reference: damlTypes.ContractId(exports.SubscriptionRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    subscription: damlTypes.ContractId(exports.Subscription).encode(__typed__.subscription),
    subscriptionData: exports.SubscriptionData.encode(__typed__.subscriptionData),
    payData: exports.SubscriptionPayData.encode(__typed__.payData),
    thisPaymentDueAt: damlTypes.Time.encode(__typed__.thisPaymentDueAt),
    targetAmount: damlTypes.Numeric(10).encode(__typed__.targetAmount),
    lockedAmulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet).encode(__typed__.lockedAmulet),
    round: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Types.Round.encode(__typed__.round),
    reference: damlTypes.ContractId(exports.SubscriptionRequest).encode(__typed__.reference),
  };
}
,
  SubscriptionPayment_Collect: {
    template: function () { return exports.SubscriptionPayment; },
    choiceName: 'SubscriptionPayment_Collect',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionPayment_Collect.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionPayment_Collect.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionPayment_CollectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionPayment_CollectResult.encode(__typed__); },
  },
  SubscriptionPayment_Reject: {
    template: function () { return exports.SubscriptionPayment; },
    choiceName: 'SubscriptionPayment_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionPayment_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionPayment_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionPayment_RejectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionPayment_RejectResult.encode(__typed__); },
  },
  SubscriptionPayment_Expire: {
    template: function () { return exports.SubscriptionPayment; },
    choiceName: 'SubscriptionPayment_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionPayment_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionPayment_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionPayment_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionPayment_ExpireResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.SubscriptionPayment; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.SubscriptionPayment, ['7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7', '#splice-wallet-payments']);



exports.SubscriptionIdleState_CancelSubscription = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};



exports.SubscriptionIdleState_ExpireSubscription = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({actor: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    actor: damlTypes.Party.encode(__typed__.actor),
  };
}
,
};



exports.SubscriptionIdleState_MakePayment = {
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



exports.SubscriptionIdleState = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet-payments:Splice.Wallet.Subscriptions:SubscriptionIdleState',
  templateIdWithPackageId: '7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7:Splice.Wallet.Subscriptions:SubscriptionIdleState',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscription: damlTypes.ContractId(exports.Subscription).decoder, subscriptionData: exports.SubscriptionData.decoder, payData: exports.SubscriptionPayData.decoder, nextPaymentDueAt: damlTypes.Time.decoder, reference: damlTypes.ContractId(exports.SubscriptionRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    subscription: damlTypes.ContractId(exports.Subscription).encode(__typed__.subscription),
    subscriptionData: exports.SubscriptionData.encode(__typed__.subscriptionData),
    payData: exports.SubscriptionPayData.encode(__typed__.payData),
    nextPaymentDueAt: damlTypes.Time.encode(__typed__.nextPaymentDueAt),
    reference: damlTypes.ContractId(exports.SubscriptionRequest).encode(__typed__.reference),
  };
}
,
  SubscriptionIdleState_MakePayment: {
    template: function () { return exports.SubscriptionIdleState; },
    choiceName: 'SubscriptionIdleState_MakePayment',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionIdleState_MakePayment.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionIdleState_MakePayment.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionIdleState_MakePaymentResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionIdleState_MakePaymentResult.encode(__typed__); },
  },
  SubscriptionIdleState_ExpireSubscription: {
    template: function () { return exports.SubscriptionIdleState; },
    choiceName: 'SubscriptionIdleState_ExpireSubscription',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionIdleState_ExpireSubscription.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionIdleState_ExpireSubscription.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionIdleState_ExpireSubscriptionResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionIdleState_ExpireSubscriptionResult.encode(__typed__); },
  },
  SubscriptionIdleState_CancelSubscription: {
    template: function () { return exports.SubscriptionIdleState; },
    choiceName: 'SubscriptionIdleState_CancelSubscription',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionIdleState_CancelSubscription.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionIdleState_CancelSubscription.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionIdleState_CancelSubscriptionResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionIdleState_CancelSubscriptionResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.SubscriptionIdleState; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.SubscriptionIdleState, ['7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7', '#splice-wallet-payments']);



exports.SubscriptionInitialPayment_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({actor: damlTypes.Party.decoder, transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    actor: damlTypes.Party.encode(__typed__.actor),
    transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.encode(__typed__.transferContext),
  };
}
,
};



exports.SubscriptionInitialPayment_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.encode(__typed__.transferContext),
  };
}
,
};



exports.SubscriptionInitialPayment_Collect = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    transferContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AppTransferContext.encode(__typed__.transferContext),
  };
}
,
};



exports.SubscriptionInitialPayment = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet-payments:Splice.Wallet.Subscriptions:SubscriptionInitialPayment',
  templateIdWithPackageId: '7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7:Splice.Wallet.Subscriptions:SubscriptionInitialPayment',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscriptionData: exports.SubscriptionData.decoder, payData: exports.SubscriptionPayData.decoder, targetAmount: damlTypes.Numeric(10).decoder, lockedAmulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet).decoder, round: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Types.Round.decoder, reference: damlTypes.ContractId(exports.SubscriptionRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    subscriptionData: exports.SubscriptionData.encode(__typed__.subscriptionData),
    payData: exports.SubscriptionPayData.encode(__typed__.payData),
    targetAmount: damlTypes.Numeric(10).encode(__typed__.targetAmount),
    lockedAmulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.LockedAmulet).encode(__typed__.lockedAmulet),
    round: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Types.Round.encode(__typed__.round),
    reference: damlTypes.ContractId(exports.SubscriptionRequest).encode(__typed__.reference),
  };
}
,
  SubscriptionInitialPayment_Collect: {
    template: function () { return exports.SubscriptionInitialPayment; },
    choiceName: 'SubscriptionInitialPayment_Collect',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionInitialPayment_Collect.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionInitialPayment_Collect.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionInitialPayment_CollectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionInitialPayment_CollectResult.encode(__typed__); },
  },
  SubscriptionInitialPayment_Reject: {
    template: function () { return exports.SubscriptionInitialPayment; },
    choiceName: 'SubscriptionInitialPayment_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionInitialPayment_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionInitialPayment_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionInitialPayment_RejectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionInitialPayment_RejectResult.encode(__typed__); },
  },
  SubscriptionInitialPayment_Expire: {
    template: function () { return exports.SubscriptionInitialPayment; },
    choiceName: 'SubscriptionInitialPayment_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionInitialPayment_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionInitialPayment_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionInitialPayment_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionInitialPayment_ExpireResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.SubscriptionInitialPayment; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.SubscriptionInitialPayment, ['7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7', '#splice-wallet-payments']);



exports.SubscriptionRequest_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};



exports.SubscriptionRequest_Withdraw = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};



exports.SubscriptionRequest_AcceptAndMakePayment = {
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



exports.SubscriptionRequest = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet-payments:Splice.Wallet.Subscriptions:SubscriptionRequest',
  templateIdWithPackageId: '7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7:Splice.Wallet.Subscriptions:SubscriptionRequest',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscriptionData: exports.SubscriptionData.decoder, payData: exports.SubscriptionPayData.decoder, }); }),
  encode: function (__typed__) {
  return {
    subscriptionData: exports.SubscriptionData.encode(__typed__.subscriptionData),
    payData: exports.SubscriptionPayData.encode(__typed__.payData),
  };
}
,
  SubscriptionRequest_AcceptAndMakePayment: {
    template: function () { return exports.SubscriptionRequest; },
    choiceName: 'SubscriptionRequest_AcceptAndMakePayment',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionRequest_AcceptAndMakePayment.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionRequest_AcceptAndMakePayment.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionRequest_AcceptAndMakePaymentResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionRequest_AcceptAndMakePaymentResult.encode(__typed__); },
  },
  SubscriptionRequest_Withdraw: {
    template: function () { return exports.SubscriptionRequest; },
    choiceName: 'SubscriptionRequest_Withdraw',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionRequest_Withdraw.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionRequest_Withdraw.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionRequest_WithdrawResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionRequest_WithdrawResult.encode(__typed__); },
  },
  SubscriptionRequest_Reject: {
    template: function () { return exports.SubscriptionRequest; },
    choiceName: 'SubscriptionRequest_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionRequest_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.SubscriptionRequest_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.SubscriptionRequest_RejectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.SubscriptionRequest_RejectResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.SubscriptionRequest; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.SubscriptionRequest, ['7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7', '#splice-wallet-payments']);



exports.SubscriptionPayData = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({paymentAmount: Splice_Wallet_Payment.PaymentAmount.decoder, paymentInterval: pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime.decoder, paymentDuration: pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime.decoder, }); }),
  encode: function (__typed__) {
  return {
    paymentAmount: Splice_Wallet_Payment.PaymentAmount.encode(__typed__.paymentAmount),
    paymentInterval: pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime.encode(__typed__.paymentInterval),
    paymentDuration: pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime.encode(__typed__.paymentDuration),
  };
}
,
};



exports.TerminatedSubscription = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet-payments:Splice.Wallet.Subscriptions:TerminatedSubscription',
  templateIdWithPackageId: '7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7:Splice.Wallet.Subscriptions:TerminatedSubscription',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscriptionData: exports.SubscriptionData.decoder, reference: damlTypes.ContractId(exports.SubscriptionRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    subscriptionData: exports.SubscriptionData.encode(__typed__.subscriptionData),
    reference: damlTypes.ContractId(exports.SubscriptionRequest).encode(__typed__.reference),
  };
}
,
  Archive: {
    template: function () { return exports.TerminatedSubscription; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.TerminatedSubscription, ['7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7', '#splice-wallet-payments']);



exports.Subscription_Archive = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};



exports.Subscription = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet-payments:Splice.Wallet.Subscriptions:Subscription',
  templateIdWithPackageId: '7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7:Splice.Wallet.Subscriptions:Subscription',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscriptionData: exports.SubscriptionData.decoder, reference: damlTypes.ContractId(exports.SubscriptionRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    subscriptionData: exports.SubscriptionData.encode(__typed__.subscriptionData),
    reference: damlTypes.ContractId(exports.SubscriptionRequest).encode(__typed__.reference),
  };
}
,
  Subscription_Archive: {
    template: function () { return exports.Subscription; },
    choiceName: 'Subscription_Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.Subscription_Archive.decoder; }),
    argumentEncode: function (__typed__) { return exports.Subscription_Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.Subscription_ArchiveResult.decoder; }),
    resultEncode: function (__typed__) { return exports.Subscription_ArchiveResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.Subscription; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.Subscription, ['7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7', '#splice-wallet-payments']);



exports.SubscriptionPayment_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscriptionState: damlTypes.ContractId(exports.SubscriptionIdleState).decoder, amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder, }); }),
  encode: function (__typed__) {
  return {
    subscriptionState: damlTypes.ContractId(exports.SubscriptionIdleState).encode(__typed__.subscriptionState),
    amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.amuletSum),
  };
}
,
};



exports.SubscriptionPayment_RejectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscriptionState: damlTypes.ContractId(exports.SubscriptionIdleState).decoder, amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder, }); }),
  encode: function (__typed__) {
  return {
    subscriptionState: damlTypes.ContractId(exports.SubscriptionIdleState).encode(__typed__.subscriptionState),
    amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.amuletSum),
  };
}
,
};



exports.SubscriptionPayment_CollectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscriptionState: damlTypes.ContractId(exports.SubscriptionIdleState).decoder, amulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet).decoder, }); }),
  encode: function (__typed__) {
  return {
    subscriptionState: damlTypes.ContractId(exports.SubscriptionIdleState).encode(__typed__.subscriptionState),
    amulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet).encode(__typed__.amulet),
  };
}
,
};



exports.SubscriptionIdleState_MakePaymentResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscriptionPayment: damlTypes.ContractId(exports.SubscriptionPayment).decoder, senderChange: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder), }); }),
  encode: function (__typed__) {
  return {
    subscriptionPayment: damlTypes.ContractId(exports.SubscriptionPayment).encode(__typed__.subscriptionPayment),
    senderChange: damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.senderChange),
  };
}
,
};



exports.SubscriptionIdleState_CancelSubscriptionResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).encode(__typed__.terminatedSubscription),
  };
}
,
};



exports.SubscriptionIdleState_ExpireSubscriptionResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).encode(__typed__.terminatedSubscription),
  };
}
,
};



exports.SubscriptionInitialPayment_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder, }); }),
  encode: function (__typed__) {
  return {
    amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.amuletSum),
  };
}
,
};



exports.SubscriptionInitialPayment_RejectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder, }); }),
  encode: function (__typed__) {
  return {
    amuletSum: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.AmuletCreateSummary(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.amuletSum),
  };
}
,
};



exports.SubscriptionInitialPayment_CollectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscription: damlTypes.ContractId(exports.Subscription).decoder, subscriptionState: damlTypes.ContractId(exports.SubscriptionIdleState).decoder, amulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet).decoder, }); }),
  encode: function (__typed__) {
  return {
    subscription: damlTypes.ContractId(exports.Subscription).encode(__typed__.subscription),
    subscriptionState: damlTypes.ContractId(exports.SubscriptionIdleState).encode(__typed__.subscriptionState),
    amulet: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet).encode(__typed__.amulet),
  };
}
,
};



exports.SubscriptionRequest_RejectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).encode(__typed__.terminatedSubscription),
  };
}
,
};



exports.SubscriptionRequest_WithdrawResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).encode(__typed__.terminatedSubscription),
  };
}
,
};



exports.SubscriptionRequest_AcceptAndMakePaymentResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({subscriptionPayment: damlTypes.ContractId(exports.SubscriptionInitialPayment).decoder, senderChange: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder), }); }),
  encode: function (__typed__) {
  return {
    subscriptionPayment: damlTypes.ContractId(exports.SubscriptionInitialPayment).encode(__typed__.subscriptionPayment),
    senderChange: damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.senderChange),
  };
}
,
};



exports.Subscription_ArchiveResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedSubscription: damlTypes.ContractId(exports.TerminatedSubscription).encode(__typed__.terminatedSubscription),
  };
}
,
};



exports.SubscriptionData = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({sender: damlTypes.Party.decoder, receiver: damlTypes.Party.decoder, provider: damlTypes.Party.decoder, dso: damlTypes.Party.decoder, description: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    sender: damlTypes.Party.encode(__typed__.sender),
    receiver: damlTypes.Party.encode(__typed__.receiver),
    provider: damlTypes.Party.encode(__typed__.provider),
    dso: damlTypes.Party.encode(__typed__.dso),
    description: damlTypes.Text.encode(__typed__.description),
  };
}
,
};

