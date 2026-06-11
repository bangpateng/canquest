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

var pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520 = require('@daml.js/splice-api-token-allocation-instruction-v1-1.0.0');
var pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281 = require('@daml.js/splice-api-token-transfer-instruction-v1-1.0.0');
var pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4 = require('@daml.js/daml-prim-DA-Types-1.0.0');
var pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7 = require('@daml.js/splice-wallet-payments-0.1.9');
var pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d = require('@daml.js/splice-api-token-allocation-v1-1.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');
var pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332 = require('@daml.js/splice-amulet-0.1.9');
var pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946 = require('@daml.js/daml-stdlib-DA-Time-Types-1.0.0');

var Splice_Wallet_BuyTrafficRequest = require('../../../Splice/Wallet/BuyTrafficRequest/module');
var Splice_Wallet_TopUpState = require('../../../Splice/Wallet/TopUpState/module');
var Splice_Wallet_TransferOffer = require('../../../Splice/Wallet/TransferOffer/module');
var Splice_Wallet_TransferPreapproval = require('../../../Splice/Wallet/TransferPreapproval/module');


exports.WalletAppInstall_Allocation_Withdraw = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({allocationCid: damlTypes.ContractId(pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation).decoder, withdrawArg: pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation_Withdraw.decoder, }); }),
  encode: function (__typed__) {
  return {
    allocationCid: damlTypes.ContractId(pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation).encode(__typed__.allocationCid),
    withdrawArg: pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation_Withdraw.encode(__typed__.withdrawArg),
  };
}
,
};



exports.WalletAppInstall_AllocationFactory_Allocate = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({allocationFactory: damlTypes.ContractId(pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520.Splice.Api.Token.AllocationInstructionV1.AllocationFactory).decoder, allocateArg: pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520.Splice.Api.Token.AllocationInstructionV1.AllocationFactory_Allocate.decoder, }); }),
  encode: function (__typed__) {
  return {
    allocationFactory: damlTypes.ContractId(pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520.Splice.Api.Token.AllocationInstructionV1.AllocationFactory).encode(__typed__.allocationFactory),
    allocateArg: pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520.Splice.Api.Token.AllocationInstructionV1.AllocationFactory_Allocate.encode(__typed__.allocateArg),
  };
}
,
};



exports.WalletAppInstall_TransferInstruction_Withdraw = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferInstructionCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction).decoder, withdrawArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction_Withdraw.decoder, }); }),
  encode: function (__typed__) {
  return {
    transferInstructionCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction).encode(__typed__.transferInstructionCid),
    withdrawArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction_Withdraw.encode(__typed__.withdrawArg),
  };
}
,
};



exports.WalletAppInstall_TransferInstruction_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferInstructionCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction).decoder, rejectArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction_Reject.decoder, }); }),
  encode: function (__typed__) {
  return {
    transferInstructionCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction).encode(__typed__.transferInstructionCid),
    rejectArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction_Reject.encode(__typed__.rejectArg),
  };
}
,
};



exports.WalletAppInstall_TransferInstruction_Accept = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferInstructionCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction).decoder, acceptArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction_Accept.decoder, }); }),
  encode: function (__typed__) {
  return {
    transferInstructionCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction).encode(__typed__.transferInstructionCid),
    acceptArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstruction_Accept.encode(__typed__.acceptArg),
  };
}
,
};



exports.WalletAppInstall_TransferFactory_Transfer = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferFactoryCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).decoder, transferArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory_Transfer.decoder, }); }),
  encode: function (__typed__) {
  return {
    transferFactoryCid: damlTypes.ContractId(pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory).encode(__typed__.transferFactoryCid),
    transferArg: pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferFactory_Transfer.encode(__typed__.transferArg),
  };
}
,
};



exports.WalletAppInstall_FeaturedAppRights_SelfGrant = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({amuletRulesCid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AmuletRules).decoder, }); }),
  encode: function (__typed__) {
  return {
    amuletRulesCid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.AmuletRules).encode(__typed__.amuletRulesCid),
  };
}
,
};



exports.WalletAppInstall_FeaturedAppRights_Cancel = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.FeaturedAppRight).decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.FeaturedAppRight).encode(__typed__.cid),
  };
}
,
};



exports.WalletAppInstall_BuyTrafficRequest_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({requestCid: damlTypes.ContractId(Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    requestCid: damlTypes.ContractId(Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest).encode(__typed__.requestCid),
  };
}
,
};



exports.WalletAppInstall_BuyTrafficRequest_Cancel = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({requestCid: damlTypes.ContractId(Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest).decoder, reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    requestCid: damlTypes.ContractId(Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest).encode(__typed__.requestCid),
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.WalletAppInstall_CreateBuyTrafficRequest = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({memberId: damlTypes.Text.decoder, synchronizerId: damlTypes.Text.decoder, migrationId: damlTypes.Int.decoder, trafficAmount: damlTypes.Int.decoder, expiresAt: damlTypes.Time.decoder, trackingId: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    memberId: damlTypes.Text.encode(__typed__.memberId),
    synchronizerId: damlTypes.Text.encode(__typed__.synchronizerId),
    migrationId: damlTypes.Int.encode(__typed__.migrationId),
    trafficAmount: damlTypes.Int.encode(__typed__.trafficAmount),
    expiresAt: damlTypes.Time.encode(__typed__.expiresAt),
    trackingId: damlTypes.Text.encode(__typed__.trackingId),
  };
}
,
};



exports.WalletAppInstall_AcceptedTransferOffer_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).encode(__typed__.cid),
  };
}
,
};



exports.WalletAppInstall_AcceptedTransferOffer_Withdraw = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).decoder, reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).encode(__typed__.cid),
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.WalletAppInstall_AcceptedTransferOffer_Abort = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).decoder, reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).encode(__typed__.cid),
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.WalletAppInstall_TransferOffer_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).encode(__typed__.cid),
  };
}
,
};



exports.WalletAppInstall_TransferOffer_Withdraw = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).decoder, reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).encode(__typed__.cid),
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.WalletAppInstall_TransferOffer_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).encode(__typed__.cid),
  };
}
,
};



exports.WalletAppInstall_TransferOffer_Accept = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).encode(__typed__.cid),
  };
}
,
};



exports.WalletAppInstall_CreateTransferOffer = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({receiver: damlTypes.Party.decoder, amount: pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.PaymentAmount.decoder, description: damlTypes.Text.decoder, expiresAt: damlTypes.Time.decoder, trackingId: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    receiver: damlTypes.Party.encode(__typed__.receiver),
    amount: pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.PaymentAmount.encode(__typed__.amount),
    description: damlTypes.Text.encode(__typed__.description),
    expiresAt: damlTypes.Time.encode(__typed__.expiresAt),
    trackingId: damlTypes.Text.encode(__typed__.trackingId),
  };
}
,
};



exports.WalletAppInstall_SubscriptionIdleState_CancelSubscription = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionIdleState).decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionIdleState).encode(__typed__.cid),
  };
}
,
};



exports.WalletAppInstall_SubscriptionRequest_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionRequest).encode(__typed__.cid),
  };
}
,
};



exports.WalletAppInstall_AppPaymentRequest_Expire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AppPaymentRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AppPaymentRequest).encode(__typed__.cid),
  };
}
,
};



exports.WalletAppInstall_AppPaymentRequest_Reject = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({cid: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AppPaymentRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    cid: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AppPaymentRequest).encode(__typed__.cid),
  };
}
,
};



exports.WalletAppInstall_ExecuteBatch = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.decoder, inputs: damlTypes.List(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput).decoder, operations: damlTypes.List(exports.AmuletOperation).decoder, }); }),
  encode: function (__typed__) {
  return {
    context: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.encode(__typed__.context),
    inputs: damlTypes.List(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferInput).encode(__typed__.inputs),
    operations: damlTypes.List(exports.AmuletOperation).encode(__typed__.operations),
  };
}
,
};



exports.WalletAppInstall = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet:Splice.Wallet.Install:WalletAppInstall',
  templateIdWithPackageId: '940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5:Splice.Wallet.Install:WalletAppInstall',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({dsoParty: damlTypes.Party.decoder, validatorParty: damlTypes.Party.decoder, endUserName: damlTypes.Text.decoder, endUserParty: damlTypes.Party.decoder, }); }),
  encode: function (__typed__) {
  return {
    dsoParty: damlTypes.Party.encode(__typed__.dsoParty),
    validatorParty: damlTypes.Party.encode(__typed__.validatorParty),
    endUserName: damlTypes.Text.encode(__typed__.endUserName),
    endUserParty: damlTypes.Party.encode(__typed__.endUserParty),
  };
}
,
  WalletAppInstall_ExecuteBatch: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_ExecuteBatch',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_ExecuteBatch.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_ExecuteBatch.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_ExecuteBatchResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_ExecuteBatchResult.encode(__typed__); },
  },
  WalletAppInstall_AppPaymentRequest_Reject: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_AppPaymentRequest_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AppPaymentRequest_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_AppPaymentRequest_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AppPaymentRequest_RejectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_AppPaymentRequest_RejectResult.encode(__typed__); },
  },
  WalletAppInstall_AppPaymentRequest_Expire: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_AppPaymentRequest_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AppPaymentRequest_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_AppPaymentRequest_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AppPaymentRequest_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_AppPaymentRequest_ExpireResult.encode(__typed__); },
  },
  WalletAppInstall_SubscriptionRequest_Reject: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_SubscriptionRequest_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_SubscriptionRequest_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_SubscriptionRequest_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_SubscriptionRequest_RejectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_SubscriptionRequest_RejectResult.encode(__typed__); },
  },
  WalletAppInstall_SubscriptionIdleState_CancelSubscription: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_SubscriptionIdleState_CancelSubscription',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_SubscriptionIdleState_CancelSubscription.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_SubscriptionIdleState_CancelSubscription.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_SubscriptionIdleState_CancelSubscriptionResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_SubscriptionIdleState_CancelSubscriptionResult.encode(__typed__); },
  },
  WalletAppInstall_CreateTransferOffer: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_CreateTransferOffer',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_CreateTransferOffer.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_CreateTransferOffer.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_CreateTransferOfferResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_CreateTransferOfferResult.encode(__typed__); },
  },
  WalletAppInstall_TransferOffer_Accept: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_TransferOffer_Accept',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferOffer_Accept.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_TransferOffer_Accept.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferOffer_AcceptResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_TransferOffer_AcceptResult.encode(__typed__); },
  },
  WalletAppInstall_TransferOffer_Reject: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_TransferOffer_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferOffer_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_TransferOffer_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferOffer_RejectResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_TransferOffer_RejectResult.encode(__typed__); },
  },
  WalletAppInstall_TransferOffer_Withdraw: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_TransferOffer_Withdraw',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferOffer_Withdraw.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_TransferOffer_Withdraw.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferOffer_WithdrawResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_TransferOffer_WithdrawResult.encode(__typed__); },
  },
  WalletAppInstall_TransferOffer_Expire: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_TransferOffer_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferOffer_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_TransferOffer_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferOffer_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_TransferOffer_ExpireResult.encode(__typed__); },
  },
  WalletAppInstall_AcceptedTransferOffer_Abort: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_AcceptedTransferOffer_Abort',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AcceptedTransferOffer_Abort.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_AcceptedTransferOffer_Abort.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AcceptedTransferOffer_AbortResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_AcceptedTransferOffer_AbortResult.encode(__typed__); },
  },
  WalletAppInstall_AcceptedTransferOffer_Withdraw: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_AcceptedTransferOffer_Withdraw',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AcceptedTransferOffer_Withdraw.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_AcceptedTransferOffer_Withdraw.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AcceptedTransferOffer_WithdrawResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_AcceptedTransferOffer_WithdrawResult.encode(__typed__); },
  },
  WalletAppInstall_AcceptedTransferOffer_Expire: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_AcceptedTransferOffer_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AcceptedTransferOffer_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_AcceptedTransferOffer_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AcceptedTransferOffer_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_AcceptedTransferOffer_ExpireResult.encode(__typed__); },
  },
  WalletAppInstall_CreateBuyTrafficRequest: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_CreateBuyTrafficRequest',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_CreateBuyTrafficRequest.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_CreateBuyTrafficRequest.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_CreateBuyTrafficRequestResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_CreateBuyTrafficRequestResult.encode(__typed__); },
  },
  WalletAppInstall_BuyTrafficRequest_Cancel: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_BuyTrafficRequest_Cancel',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_BuyTrafficRequest_Cancel.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_BuyTrafficRequest_Cancel.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_BuyTrafficRequest_CancelResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_BuyTrafficRequest_CancelResult.encode(__typed__); },
  },
  WalletAppInstall_BuyTrafficRequest_Expire: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_BuyTrafficRequest_Expire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_BuyTrafficRequest_Expire.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_BuyTrafficRequest_Expire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_BuyTrafficRequest_ExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_BuyTrafficRequest_ExpireResult.encode(__typed__); },
  },
  WalletAppInstall_FeaturedAppRights_Cancel: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_FeaturedAppRights_Cancel',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_FeaturedAppRights_Cancel.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_FeaturedAppRights_Cancel.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_FeaturedAppRights_CancelResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_FeaturedAppRights_CancelResult.encode(__typed__); },
  },
  WalletAppInstall_FeaturedAppRights_SelfGrant: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_FeaturedAppRights_SelfGrant',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_FeaturedAppRights_SelfGrant.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_FeaturedAppRights_SelfGrant.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_FeaturedAppRights_SelfGrantResult.decoder; }),
    resultEncode: function (__typed__) { return exports.WalletAppInstall_FeaturedAppRights_SelfGrantResult.encode(__typed__); },
  },
  WalletAppInstall_TransferFactory_Transfer: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_TransferFactory_Transfer',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferFactory_Transfer.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_TransferFactory_Transfer.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult.decoder; }),
    resultEncode: function (__typed__) { return pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult.encode(__typed__); },
  },
  WalletAppInstall_TransferInstruction_Accept: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_TransferInstruction_Accept',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferInstruction_Accept.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_TransferInstruction_Accept.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult.decoder; }),
    resultEncode: function (__typed__) { return pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult.encode(__typed__); },
  },
  WalletAppInstall_TransferInstruction_Reject: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_TransferInstruction_Reject',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferInstruction_Reject.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_TransferInstruction_Reject.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult.decoder; }),
    resultEncode: function (__typed__) { return pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult.encode(__typed__); },
  },
  WalletAppInstall_TransferInstruction_Withdraw: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_TransferInstruction_Withdraw',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_TransferInstruction_Withdraw.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_TransferInstruction_Withdraw.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult.decoder; }),
    resultEncode: function (__typed__) { return pkg55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281.Splice.Api.Token.TransferInstructionV1.TransferInstructionResult.encode(__typed__); },
  },
  WalletAppInstall_AllocationFactory_Allocate: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_AllocationFactory_Allocate',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_AllocationFactory_Allocate.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_AllocationFactory_Allocate.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520.Splice.Api.Token.AllocationInstructionV1.AllocationInstructionResult.decoder; }),
    resultEncode: function (__typed__) { return pkg275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520.Splice.Api.Token.AllocationInstructionV1.AllocationInstructionResult.encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
  WalletAppInstall_Allocation_Withdraw: {
    template: function () { return exports.WalletAppInstall; },
    choiceName: 'WalletAppInstall_Allocation_Withdraw',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.WalletAppInstall_Allocation_Withdraw.decoder; }),
    argumentEncode: function (__typed__) { return exports.WalletAppInstall_Allocation_Withdraw.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation_WithdrawResult.decoder; }),
    resultEncode: function (__typed__) { return pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation_WithdrawResult.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.WalletAppInstall, ['940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5', '#splice-wallet']);



exports.WalletAppInstall_TransferPreapprovalProposal_CreateResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({preapprovalProposalCid: damlTypes.ContractId(Splice_Wallet_TransferPreapproval.TransferPreapprovalProposal).decoder, }); }),
  encode: function (__typed__) {
  return {
    preapprovalProposalCid: damlTypes.ContractId(Splice_Wallet_TransferPreapproval.TransferPreapprovalProposal).encode(__typed__.preapprovalProposalCid),
  };
}
,
};



exports.WalletAppInstall_FeaturedAppRights_SelfGrantResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({featuredAppRight: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.FeaturedAppRight).decoder, }); }),
  encode: function (__typed__) {
  return {
    featuredAppRight: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.FeaturedAppRight).encode(__typed__.featuredAppRight),
  };
}
,
};



exports.WalletAppInstall_FeaturedAppRights_CancelResult = {
  WalletAppInstall_FeaturedAppRights_CancelResult: 'WalletAppInstall_FeaturedAppRights_CancelResult',
  keys: ['WalletAppInstall_FeaturedAppRights_CancelResult',],
  decoder: damlTypes.lazyMemo(function () { return jtv.oneOf(jtv.constant(exports.WalletAppInstall_FeaturedAppRights_CancelResult.WalletAppInstall_FeaturedAppRights_CancelResult)); }),
  encode: function (__typed__) { return __typed__; },
};



exports.WalletAppInstall_BuyTrafficRequest_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: Splice_Wallet_BuyTrafficRequest.BuyTrafficRequestTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: Splice_Wallet_BuyTrafficRequest.BuyTrafficRequestTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.WalletAppInstall_BuyTrafficRequest_CancelResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: Splice_Wallet_BuyTrafficRequest.BuyTrafficRequestTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: Splice_Wallet_BuyTrafficRequest.BuyTrafficRequestTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.WalletAppInstall_CreateBuyTrafficRequestResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({buyTrafficRequest: damlTypes.ContractId(Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest).decoder, }); }),
  encode: function (__typed__) {
  return {
    buyTrafficRequest: damlTypes.ContractId(Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest).encode(__typed__.buyTrafficRequest),
  };
}
,
};



exports.WalletAppInstall_AcceptedTransferOffer_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.WalletAppInstall_AcceptedTransferOffer_WithdrawResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.WalletAppInstall_AcceptedTransferOffer_AbortResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.WalletAppInstall_TransferOffer_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.WalletAppInstall_TransferOffer_WithdrawResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.WalletAppInstall_TransferOffer_RejectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.decoder, }); }),
  encode: function (__typed__) {
  return {
    trackingInfo: Splice_Wallet_TransferOffer.TransferOfferTrackingInfo.encode(__typed__.trackingInfo),
  };
}
,
};



exports.WalletAppInstall_TransferOffer_AcceptResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({acceptedTransferOffer: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).decoder, }); }),
  encode: function (__typed__) {
  return {
    acceptedTransferOffer: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).encode(__typed__.acceptedTransferOffer),
  };
}
,
};



exports.WalletAppInstall_CreateTransferOfferResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({transferOffer: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).decoder, }); }),
  encode: function (__typed__) {
  return {
    transferOffer: damlTypes.ContractId(Splice_Wallet_TransferOffer.TransferOffer).encode(__typed__.transferOffer),
  };
}
,
};



exports.WalletAppInstall_SubscriptionIdleState_CancelSubscriptionResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedSubscription: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.TerminatedSubscription).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedSubscription: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.TerminatedSubscription).encode(__typed__.terminatedSubscription),
  };
}
,
};



exports.WalletAppInstall_SubscriptionRequest_RejectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedSubscription: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.TerminatedSubscription).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedSubscription: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.TerminatedSubscription).encode(__typed__.terminatedSubscription),
  };
}
,
};



exports.WalletAppInstall_AppPaymentRequest_ExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedAppPayment: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.TerminatedAppPayment).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedAppPayment: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.TerminatedAppPayment).encode(__typed__.terminatedAppPayment),
  };
}
,
};



exports.WalletAppInstall_AppPaymentRequest_RejectResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({terminatedAppPayment: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.TerminatedAppPayment).decoder, }); }),
  encode: function (__typed__) {
  return {
    terminatedAppPayment: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.TerminatedAppPayment).encode(__typed__.terminatedAppPayment),
  };
}
,
};



exports.WalletAppInstall_ExecuteBatchResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({endUserName: damlTypes.Text.decoder, outcomes: damlTypes.List(exports.AmuletOperationOutcome).decoder, optEndUserParty: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Party).decoder), }); }),
  encode: function (__typed__) {
  return {
    endUserName: damlTypes.Text.encode(__typed__.endUserName),
    outcomes: damlTypes.List(exports.AmuletOperationOutcome).encode(__typed__.outcomes),
    optEndUserParty: damlTypes.Optional(damlTypes.Party).encode(__typed__.optEndUserParty),
  };
}
,
};



exports.AmuletOperationOutcome = {
  decoder: damlTypes.lazyMemo(function () { return jtv.oneOf(jtv.object({tag: jtv.constant('COO_AcceptedAppPayment'), value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AcceptedAppPayment).decoder, }), jtv.object({tag: jtv.constant('COO_CompleteAcceptedTransfer'), value: pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferResult, Splice_Wallet_TransferOffer.TransferOfferTrackingInfo).decoder, }), jtv.object({tag: jtv.constant('COO_SubscriptionInitialPayment'), value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionInitialPayment).decoder, }), jtv.object({tag: jtv.constant('COO_SubscriptionPayment'), value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionPayment).decoder, }), jtv.object({tag: jtv.constant('COO_MergeTransferInputs'), value: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder), }), jtv.object({tag: jtv.constant('COO_BuyMemberTraffic'), value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.DecentralizedSynchronizer.MemberTraffic).decoder, }), jtv.object({tag: jtv.constant('COO_CompleteBuyTrafficRequest'), value: pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.DecentralizedSynchronizer.MemberTraffic), Splice_Wallet_BuyTrafficRequest.BuyTrafficRequestTrackingInfo).decoder, }), jtv.object({tag: jtv.constant('COO_Tap'), value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet).decoder, }), jtv.object({tag: jtv.constant('COO_Error'), value: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.InvalidTransferReason.decoder, }), jtv.object({tag: jtv.constant('ExtAmuletOperationOutcome'), value: exports.AmuletOperationOutcome.ExtAmuletOperationOutcome.decoder, }), jtv.object({tag: jtv.constant('COO_CreateExternalPartySetupProposal'), value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.ExternalPartySetupProposal).decoder, }), jtv.object({tag: jtv.constant('COO_AcceptTransferPreapprovalProposal'), value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).decoder, }), jtv.object({tag: jtv.constant('COO_RenewTransferPreapproval'), value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).decoder, }), jtv.object({tag: jtv.constant('COO_TransferPreapprovalSend'), value: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).decoder), })); }),
  encode: function (__typed__) {
  switch(__typed__.tag) {
    case 'COO_AcceptedAppPayment': return {tag: __typed__.tag, value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AcceptedAppPayment).encode(__typed__.value)};
    case 'COO_CompleteAcceptedTransfer': return {tag: __typed__.tag, value: pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferResult, Splice_Wallet_TransferOffer.TransferOfferTrackingInfo).encode(__typed__.value)};
    case 'COO_SubscriptionInitialPayment': return {tag: __typed__.tag, value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionInitialPayment).encode(__typed__.value)};
    case 'COO_SubscriptionPayment': return {tag: __typed__.tag, value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionPayment).encode(__typed__.value)};
    case 'COO_MergeTransferInputs': return {tag: __typed__.tag, value: damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.value)};
    case 'COO_BuyMemberTraffic': return {tag: __typed__.tag, value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.DecentralizedSynchronizer.MemberTraffic).encode(__typed__.value)};
    case 'COO_CompleteBuyTrafficRequest': return {tag: __typed__.tag, value: pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.DecentralizedSynchronizer.MemberTraffic), Splice_Wallet_BuyTrafficRequest.BuyTrafficRequestTrackingInfo).encode(__typed__.value)};
    case 'COO_Tap': return {tag: __typed__.tag, value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet).encode(__typed__.value)};
    case 'COO_Error': return {tag: __typed__.tag, value: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.InvalidTransferReason.encode(__typed__.value)};
    case 'ExtAmuletOperationOutcome': return {tag: __typed__.tag, value: exports.AmuletOperationOutcome.ExtAmuletOperationOutcome.encode(__typed__.value)};
    case 'COO_CreateExternalPartySetupProposal': return {tag: __typed__.tag, value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.ExternalPartySetupProposal).encode(__typed__.value)};
    case 'COO_AcceptTransferPreapprovalProposal': return {tag: __typed__.tag, value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).encode(__typed__.value)};
    case 'COO_RenewTransferPreapproval': return {tag: __typed__.tag, value: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).encode(__typed__.value)};
    case 'COO_TransferPreapprovalSend': return {tag: __typed__.tag, value: damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.Amulet)).encode(__typed__.value)};
    default: throw 'unrecognized type tag: ' + __typed__.tag + ' while serializing a value of type AmuletOperationOutcome';
  }
}
,
  ExtAmuletOperationOutcome:({
    decoder: damlTypes.lazyMemo(function () { return jtv.object({dummyUnitField: damlTypes.Unit.decoder, }); }),
    encode: function (__typed__) {
  return {
    dummyUnitField: damlTypes.Unit.encode(__typed__.dummyUnitField),
  };
}
,
  }),
};





exports.AmuletOperation = {
  decoder: damlTypes.lazyMemo(function () { return jtv.oneOf(jtv.object({tag: jtv.constant('CO_AppPayment'), value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AppPaymentRequest).decoder, }), jtv.object({tag: jtv.constant('CO_CompleteAcceptedTransfer'), value: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).decoder, }), jtv.object({tag: jtv.constant('CO_SubscriptionAcceptAndMakeInitialPayment'), value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionRequest).decoder, }), jtv.object({tag: jtv.constant('CO_SubscriptionMakePayment'), value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionIdleState).decoder, }), jtv.object({tag: jtv.constant('CO_MergeTransferInputs'), value: damlTypes.Unit.decoder, }), jtv.object({tag: jtv.constant('CO_BuyMemberTraffic'), value: exports.AmuletOperation.CO_BuyMemberTraffic.decoder, }), jtv.object({tag: jtv.constant('CO_CompleteBuyTrafficRequest'), value: exports.AmuletOperation.CO_CompleteBuyTrafficRequest.decoder, }), jtv.object({tag: jtv.constant('CO_Tap'), value: exports.AmuletOperation.CO_Tap.decoder, }), jtv.object({tag: jtv.constant('ExtAmuletOperation'), value: exports.AmuletOperation.ExtAmuletOperation.decoder, }), jtv.object({tag: jtv.constant('CO_CreateExternalPartySetupProposal'), value: exports.AmuletOperation.CO_CreateExternalPartySetupProposal.decoder, }), jtv.object({tag: jtv.constant('CO_AcceptTransferPreapprovalProposal'), value: exports.AmuletOperation.CO_AcceptTransferPreapprovalProposal.decoder, }), jtv.object({tag: jtv.constant('CO_RenewTransferPreapproval'), value: exports.AmuletOperation.CO_RenewTransferPreapproval.decoder, }), jtv.object({tag: jtv.constant('CO_TransferPreapprovalSend'), value: exports.AmuletOperation.CO_TransferPreapprovalSend.decoder, })); }),
  encode: function (__typed__) {
  switch(__typed__.tag) {
    case 'CO_AppPayment': return {tag: __typed__.tag, value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Payment.AppPaymentRequest).encode(__typed__.value)};
    case 'CO_CompleteAcceptedTransfer': return {tag: __typed__.tag, value: damlTypes.ContractId(Splice_Wallet_TransferOffer.AcceptedTransferOffer).encode(__typed__.value)};
    case 'CO_SubscriptionAcceptAndMakeInitialPayment': return {tag: __typed__.tag, value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionRequest).encode(__typed__.value)};
    case 'CO_SubscriptionMakePayment': return {tag: __typed__.tag, value: damlTypes.ContractId(pkg7f4e081ad96f2ccded0c053b0cf5ddddae1139dfc3bb89cefcf77ea70f2cecb7.Splice.Wallet.Subscriptions.SubscriptionIdleState).encode(__typed__.value)};
    case 'CO_MergeTransferInputs': return {tag: __typed__.tag, value: damlTypes.Unit.encode(__typed__.value)};
    case 'CO_BuyMemberTraffic': return {tag: __typed__.tag, value: exports.AmuletOperation.CO_BuyMemberTraffic.encode(__typed__.value)};
    case 'CO_CompleteBuyTrafficRequest': return {tag: __typed__.tag, value: exports.AmuletOperation.CO_CompleteBuyTrafficRequest.encode(__typed__.value)};
    case 'CO_Tap': return {tag: __typed__.tag, value: exports.AmuletOperation.CO_Tap.encode(__typed__.value)};
    case 'ExtAmuletOperation': return {tag: __typed__.tag, value: exports.AmuletOperation.ExtAmuletOperation.encode(__typed__.value)};
    case 'CO_CreateExternalPartySetupProposal': return {tag: __typed__.tag, value: exports.AmuletOperation.CO_CreateExternalPartySetupProposal.encode(__typed__.value)};
    case 'CO_AcceptTransferPreapprovalProposal': return {tag: __typed__.tag, value: exports.AmuletOperation.CO_AcceptTransferPreapprovalProposal.encode(__typed__.value)};
    case 'CO_RenewTransferPreapproval': return {tag: __typed__.tag, value: exports.AmuletOperation.CO_RenewTransferPreapproval.encode(__typed__.value)};
    case 'CO_TransferPreapprovalSend': return {tag: __typed__.tag, value: exports.AmuletOperation.CO_TransferPreapprovalSend.encode(__typed__.value)};
    default: throw 'unrecognized type tag: ' + __typed__.tag + ' while serializing a value of type AmuletOperation';
  }
}
,
  CO_BuyMemberTraffic:({
    decoder: damlTypes.lazyMemo(function () { return jtv.object({trafficAmount: damlTypes.Int.decoder, memberId: damlTypes.Text.decoder, synchronizerId: damlTypes.Text.decoder, migrationId: damlTypes.Int.decoder, minTopupInterval: pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime.decoder, topupStateCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(Splice_Wallet_TopUpState.ValidatorTopUpState)).decoder), }); }),
    encode: function (__typed__) {
  return {
    trafficAmount: damlTypes.Int.encode(__typed__.trafficAmount),
    memberId: damlTypes.Text.encode(__typed__.memberId),
    synchronizerId: damlTypes.Text.encode(__typed__.synchronizerId),
    migrationId: damlTypes.Int.encode(__typed__.migrationId),
    minTopupInterval: pkgb70db8369e1c461d5c70f1c86f526a29e9776c655e6ffc2560f95b05ccb8b946.DA.Time.Types.RelTime.encode(__typed__.minTopupInterval),
    topupStateCid: damlTypes.Optional(damlTypes.ContractId(Splice_Wallet_TopUpState.ValidatorTopUpState)).encode(__typed__.topupStateCid),
  };
}
,
  }),
  CO_CompleteBuyTrafficRequest:({
    decoder: damlTypes.lazyMemo(function () { return jtv.object({trafficRequestCid: damlTypes.ContractId(Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest).decoder, }); }),
    encode: function (__typed__) {
  return {
    trafficRequestCid: damlTypes.ContractId(Splice_Wallet_BuyTrafficRequest.BuyTrafficRequest).encode(__typed__.trafficRequestCid),
  };
}
,
  }),
  CO_Tap:({
    decoder: damlTypes.lazyMemo(function () { return jtv.object({tapAmount: damlTypes.Numeric(10).decoder, }); }),
    encode: function (__typed__) {
  return {
    tapAmount: damlTypes.Numeric(10).encode(__typed__.tapAmount),
  };
}
,
  }),
  ExtAmuletOperation:({
    decoder: damlTypes.lazyMemo(function () { return jtv.object({dummyUnitField: damlTypes.Unit.decoder, }); }),
    encode: function (__typed__) {
  return {
    dummyUnitField: damlTypes.Unit.encode(__typed__.dummyUnitField),
  };
}
,
  }),
  CO_CreateExternalPartySetupProposal:({
    decoder: damlTypes.lazyMemo(function () { return jtv.object({externalParty: damlTypes.Party.decoder, preapprovalExpiresAt: damlTypes.Time.decoder, }); }),
    encode: function (__typed__) {
  return {
    externalParty: damlTypes.Party.encode(__typed__.externalParty),
    preapprovalExpiresAt: damlTypes.Time.encode(__typed__.preapprovalExpiresAt),
  };
}
,
  }),
  CO_AcceptTransferPreapprovalProposal:({
    decoder: damlTypes.lazyMemo(function () { return jtv.object({preapprovalProposalCid: damlTypes.ContractId(Splice_Wallet_TransferPreapproval.TransferPreapprovalProposal).decoder, expiresAt: damlTypes.Time.decoder, }); }),
    encode: function (__typed__) {
  return {
    preapprovalProposalCid: damlTypes.ContractId(Splice_Wallet_TransferPreapproval.TransferPreapprovalProposal).encode(__typed__.preapprovalProposalCid),
    expiresAt: damlTypes.Time.encode(__typed__.expiresAt),
  };
}
,
  }),
  CO_RenewTransferPreapproval:({
    decoder: damlTypes.lazyMemo(function () { return jtv.object({previousApprovalCid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).decoder, newExpiresAt: damlTypes.Time.decoder, }); }),
    encode: function (__typed__) {
  return {
    previousApprovalCid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).encode(__typed__.previousApprovalCid),
    newExpiresAt: damlTypes.Time.encode(__typed__.newExpiresAt),
  };
}
,
  }),
  CO_TransferPreapprovalSend:({
    decoder: damlTypes.lazyMemo(function () { return jtv.object({transferPreapprovalCid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).decoder, providerFeaturedAppRightCid: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.FeaturedAppRight)).decoder), amount: damlTypes.Numeric(10).decoder, description: jtv.Decoder.withDefault(null, damlTypes.Optional(damlTypes.Text).decoder), }); }),
    encode: function (__typed__) {
  return {
    transferPreapprovalCid: damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.TransferPreapproval).encode(__typed__.transferPreapprovalCid),
    providerFeaturedAppRightCid: damlTypes.Optional(damlTypes.ContractId(pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.Amulet.FeaturedAppRight)).encode(__typed__.providerFeaturedAppRightCid),
    amount: damlTypes.Numeric(10).encode(__typed__.amount),
    description: damlTypes.Optional(damlTypes.Text).encode(__typed__.description),
  };
}
,
  }),
};



















exports.ExecutionContext = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({dso: damlTypes.Party.decoder, endUser: damlTypes.Party.decoder, validator: damlTypes.Party.decoder, paymentContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.decoder, }); }),
  encode: function (__typed__) {
  return {
    dso: damlTypes.Party.encode(__typed__.dso),
    endUser: damlTypes.Party.encode(__typed__.endUser),
    validator: damlTypes.Party.encode(__typed__.validator),
    paymentContext: pkga5b055492fb8f08b2e7bc0fc94da6da50c39c2e1d7f24cd5ea8db12fc87c1332.Splice.AmuletRules.PaymentTransferContext.encode(__typed__.paymentContext),
  };
}
,
};

