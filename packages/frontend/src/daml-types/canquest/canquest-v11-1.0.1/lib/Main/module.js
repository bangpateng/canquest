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


exports.SettleCcTransaction = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({txId: damlTypes.Text.decoder, settledAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    txId: damlTypes.Text.encode(__typed__.txId),
    settledAt: damlTypes.Text.encode(__typed__.settledAt),
  };
}
,
};



exports.CcTransactionLog = damlTypes.assembleTemplate(
{
  templateId: '#canquest-v11:Main:CcTransactionLog',
  templateIdWithPackageId: '1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd:Main:CcTransactionLog',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({admin: damlTypes.Party.decoder, userAddress: damlTypes.Party.decoder, username: damlTypes.Text.decoder, txLogId: damlTypes.Text.decoder, txType: damlTypes.Text.decoder, amountMicroCc: damlTypes.Int.decoder, description: damlTypes.Text.decoder, referenceId: damlTypes.Text.decoder, ledgerTxId: damlTypes.Text.decoder, createdAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    admin: damlTypes.Party.encode(__typed__.admin),
    userAddress: damlTypes.Party.encode(__typed__.userAddress),
    username: damlTypes.Text.encode(__typed__.username),
    txLogId: damlTypes.Text.encode(__typed__.txLogId),
    txType: damlTypes.Text.encode(__typed__.txType),
    amountMicroCc: damlTypes.Int.encode(__typed__.amountMicroCc),
    description: damlTypes.Text.encode(__typed__.description),
    referenceId: damlTypes.Text.encode(__typed__.referenceId),
    ledgerTxId: damlTypes.Text.encode(__typed__.ledgerTxId),
    createdAt: damlTypes.Text.encode(__typed__.createdAt),
  };
}
,
  Archive: {
    template: function () { return exports.CcTransactionLog; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
  SettleCcTransaction: {
    template: function () { return exports.CcTransactionLog; },
    choiceName: 'SettleCcTransaction',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.SettleCcTransaction.decoder; }),
    argumentEncode: function (__typed__) { return exports.SettleCcTransaction.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.CcTransactionLog).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.CcTransactionLog).encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.CcTransactionLog, ['1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd', '#canquest-v11']);



exports.ConfirmReferralProcessed = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({confirmedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    confirmedAt: damlTypes.Text.encode(__typed__.confirmedAt),
  };
}
,
};



exports.ReferralReward = damlTypes.assembleTemplate(
{
  templateId: '#canquest-v11:Main:ReferralReward',
  templateIdWithPackageId: '1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd:Main:ReferralReward',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({admin: damlTypes.Party.decoder, referrerAddress: damlTypes.Party.decoder, referrerId: damlTypes.Text.decoder, referredUserId: damlTypes.Text.decoder, points: damlTypes.Int.decoder, referralId: damlTypes.Text.decoder, createdAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    admin: damlTypes.Party.encode(__typed__.admin),
    referrerAddress: damlTypes.Party.encode(__typed__.referrerAddress),
    referrerId: damlTypes.Text.encode(__typed__.referrerId),
    referredUserId: damlTypes.Text.encode(__typed__.referredUserId),
    points: damlTypes.Int.encode(__typed__.points),
    referralId: damlTypes.Text.encode(__typed__.referralId),
    createdAt: damlTypes.Text.encode(__typed__.createdAt),
  };
}
,
  ConfirmReferralProcessed: {
    template: function () { return exports.ReferralReward; },
    choiceName: 'ConfirmReferralProcessed',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.ConfirmReferralProcessed.decoder; }),
    argumentEncode: function (__typed__) { return exports.ConfirmReferralProcessed.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.ReferralReward).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.ReferralReward).encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.ReferralReward; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.ReferralReward, ['1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd', '#canquest-v11']);



exports.SpinCcReward = damlTypes.assembleTemplate(
{
  templateId: '#canquest-v11:Main:SpinCcReward',
  templateIdWithPackageId: '1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd:Main:SpinCcReward',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({admin: damlTypes.Party.decoder, userAddress: damlTypes.Party.decoder, username: damlTypes.Text.decoder, spinResultId: damlTypes.Text.decoder, rewardCc: damlTypes.Numeric(10).decoder, spliceTxId: damlTypes.Text.decoder, deliveredAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    admin: damlTypes.Party.encode(__typed__.admin),
    userAddress: damlTypes.Party.encode(__typed__.userAddress),
    username: damlTypes.Text.encode(__typed__.username),
    spinResultId: damlTypes.Text.encode(__typed__.spinResultId),
    rewardCc: damlTypes.Numeric(10).encode(__typed__.rewardCc),
    spliceTxId: damlTypes.Text.encode(__typed__.spliceTxId),
    deliveredAt: damlTypes.Text.encode(__typed__.deliveredAt),
  };
}
,
  Archive: {
    template: function () { return exports.SpinCcReward; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.SpinCcReward, ['1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd', '#canquest-v11']);



exports.ConfirmCcDelivered = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({spliceTxId: damlTypes.Text.decoder, deliveredAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    spliceTxId: damlTypes.Text.encode(__typed__.spliceTxId),
    deliveredAt: damlTypes.Text.encode(__typed__.deliveredAt),
  };
}
,
};



exports.SpinExecution = damlTypes.assembleTemplate(
{
  templateId: '#canquest-v11:Main:SpinExecution',
  templateIdWithPackageId: '1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd:Main:SpinExecution',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({admin: damlTypes.Party.decoder, userAddress: damlTypes.Party.decoder, username: damlTypes.Text.decoder, spinResultId: damlTypes.Text.decoder, spinItemId: damlTypes.Text.decoder, spinItemLabel: damlTypes.Text.decoder, rewardType: damlTypes.Text.decoder, rewardCc: damlTypes.Numeric(10).decoder, rewardPoints: damlTypes.Text.decoder, spinCost: damlTypes.Text.decoder, executedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    admin: damlTypes.Party.encode(__typed__.admin),
    userAddress: damlTypes.Party.encode(__typed__.userAddress),
    username: damlTypes.Text.encode(__typed__.username),
    spinResultId: damlTypes.Text.encode(__typed__.spinResultId),
    spinItemId: damlTypes.Text.encode(__typed__.spinItemId),
    spinItemLabel: damlTypes.Text.encode(__typed__.spinItemLabel),
    rewardType: damlTypes.Text.encode(__typed__.rewardType),
    rewardCc: damlTypes.Numeric(10).encode(__typed__.rewardCc),
    rewardPoints: damlTypes.Text.encode(__typed__.rewardPoints),
    spinCost: damlTypes.Text.encode(__typed__.spinCost),
    executedAt: damlTypes.Text.encode(__typed__.executedAt),
  };
}
,
  ConfirmCcDelivered: {
    template: function () { return exports.SpinExecution; },
    choiceName: 'ConfirmCcDelivered',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.ConfirmCcDelivered.decoder; }),
    argumentEncode: function (__typed__) { return exports.ConfirmCcDelivered.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.SpinCcReward).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.SpinCcReward).encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.SpinExecution; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.SpinExecution, ['1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd', '#canquest-v11']);



exports.VerifyCheckIn = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({verifiedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    verifiedAt: damlTypes.Text.encode(__typed__.verifiedAt),
  };
}
,
};



exports.DailyCheckIn = damlTypes.assembleTemplate(
{
  templateId: '#canquest-v11:Main:DailyCheckIn',
  templateIdWithPackageId: '1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd:Main:DailyCheckIn',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({admin: damlTypes.Party.decoder, userAddress: damlTypes.Party.decoder, username: damlTypes.Text.decoder, checkInId: damlTypes.Text.decoder, checkInDate: damlTypes.Text.decoder, pointsAwarded: damlTypes.Int.decoder, streakCount: damlTypes.Int.decoder, checkedInAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    admin: damlTypes.Party.encode(__typed__.admin),
    userAddress: damlTypes.Party.encode(__typed__.userAddress),
    username: damlTypes.Text.encode(__typed__.username),
    checkInId: damlTypes.Text.encode(__typed__.checkInId),
    checkInDate: damlTypes.Text.encode(__typed__.checkInDate),
    pointsAwarded: damlTypes.Int.encode(__typed__.pointsAwarded),
    streakCount: damlTypes.Int.encode(__typed__.streakCount),
    checkedInAt: damlTypes.Text.encode(__typed__.checkedInAt),
  };
}
,
  VerifyCheckIn: {
    template: function () { return exports.DailyCheckIn; },
    choiceName: 'VerifyCheckIn',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.VerifyCheckIn.decoder; }),
    argumentEncode: function (__typed__) { return exports.VerifyCheckIn.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.DailyCheckIn).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.DailyCheckIn).encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.DailyCheckIn; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.DailyCheckIn, ['1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd', '#canquest-v11']);



exports.AtomicFeeAndReward = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({feeTxId: damlTypes.Text.decoder, feeConfirmedAt: damlTypes.Text.decoder, rewardTxId: damlTypes.Text.decoder, rewardSentAt: damlTypes.Text.decoder, txLogId: damlTypes.Text.decoder, amountMicroCc: damlTypes.Int.decoder, description: damlTypes.Text.decoder, referenceId: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    feeTxId: damlTypes.Text.encode(__typed__.feeTxId),
    feeConfirmedAt: damlTypes.Text.encode(__typed__.feeConfirmedAt),
    rewardTxId: damlTypes.Text.encode(__typed__.rewardTxId),
    rewardSentAt: damlTypes.Text.encode(__typed__.rewardSentAt),
    txLogId: damlTypes.Text.encode(__typed__.txLogId),
    amountMicroCc: damlTypes.Int.encode(__typed__.amountMicroCc),
    description: damlTypes.Text.encode(__typed__.description),
    referenceId: damlTypes.Text.encode(__typed__.referenceId),
  };
}
,
};



exports.RevealRewardCode = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({code: damlTypes.Text.decoder, revealedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    code: damlTypes.Text.encode(__typed__.code),
    revealedAt: damlTypes.Text.encode(__typed__.revealedAt),
  };
}
,
};



exports.ConfirmRewardSent = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({txId: damlTypes.Text.decoder, sentAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    txId: damlTypes.Text.encode(__typed__.txId),
    sentAt: damlTypes.Text.encode(__typed__.sentAt),
  };
}
,
};



exports.ConfirmFeePaid = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({txId: damlTypes.Text.decoder, confirmedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    txId: damlTypes.Text.encode(__typed__.txId),
    confirmedAt: damlTypes.Text.encode(__typed__.confirmedAt),
  };
}
,
};



exports.QuestClaim = damlTypes.assembleTemplate(
{
  templateId: '#canquest-v11:Main:QuestClaim',
  templateIdWithPackageId: '1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd:Main:QuestClaim',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({admin: damlTypes.Party.decoder, userAddress: damlTypes.Party.decoder, campaignId: damlTypes.Text.decoder, claimId: damlTypes.Text.decoder, claimKind: damlTypes.Text.decoder, rewardCc: damlTypes.Numeric(10).decoder, rewardCode: damlTypes.Text.decoder, claimFeeCc: damlTypes.Numeric(10).decoder, feePaid: damlTypes.Bool.decoder, feeTxId: damlTypes.Text.decoder, rewardSent: damlTypes.Bool.decoder, rewardTxId: damlTypes.Text.decoder, claimedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    admin: damlTypes.Party.encode(__typed__.admin),
    userAddress: damlTypes.Party.encode(__typed__.userAddress),
    campaignId: damlTypes.Text.encode(__typed__.campaignId),
    claimId: damlTypes.Text.encode(__typed__.claimId),
    claimKind: damlTypes.Text.encode(__typed__.claimKind),
    rewardCc: damlTypes.Numeric(10).encode(__typed__.rewardCc),
    rewardCode: damlTypes.Text.encode(__typed__.rewardCode),
    claimFeeCc: damlTypes.Numeric(10).encode(__typed__.claimFeeCc),
    feePaid: damlTypes.Bool.encode(__typed__.feePaid),
    feeTxId: damlTypes.Text.encode(__typed__.feeTxId),
    rewardSent: damlTypes.Bool.encode(__typed__.rewardSent),
    rewardTxId: damlTypes.Text.encode(__typed__.rewardTxId),
    claimedAt: damlTypes.Text.encode(__typed__.claimedAt),
  };
}
,
  ConfirmFeePaid: {
    template: function () { return exports.QuestClaim; },
    choiceName: 'ConfirmFeePaid',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.ConfirmFeePaid.decoder; }),
    argumentEncode: function (__typed__) { return exports.ConfirmFeePaid.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.QuestClaim).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.QuestClaim).encode(__typed__); },
  },
  ConfirmRewardSent: {
    template: function () { return exports.QuestClaim; },
    choiceName: 'ConfirmRewardSent',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.ConfirmRewardSent.decoder; }),
    argumentEncode: function (__typed__) { return exports.ConfirmRewardSent.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.QuestClaim).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.QuestClaim).encode(__typed__); },
  },
  RevealRewardCode: {
    template: function () { return exports.QuestClaim; },
    choiceName: 'RevealRewardCode',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.RevealRewardCode.decoder; }),
    argumentEncode: function (__typed__) { return exports.RevealRewardCode.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.QuestClaim).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.QuestClaim).encode(__typed__); },
  },
  AtomicFeeAndReward: {
    template: function () { return exports.QuestClaim; },
    choiceName: 'AtomicFeeAndReward',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AtomicFeeAndReward.decoder; }),
    argumentEncode: function (__typed__) { return exports.AtomicFeeAndReward.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple3(damlTypes.ContractId(exports.QuestClaim), damlTypes.ContractId(exports.QuestClaim), damlTypes.ContractId(exports.CcTransactionLog)).decoder; }),
    resultEncode: function (__typed__) { return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple3(damlTypes.ContractId(exports.QuestClaim), damlTypes.ContractId(exports.QuestClaim), damlTypes.ContractId(exports.CcTransactionLog)).encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.QuestClaim; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.QuestClaim, ['1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd', '#canquest-v11']);



exports.UpdateCampaignStatus = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({newStatus: damlTypes.Text.decoder, updatedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    newStatus: damlTypes.Text.encode(__typed__.newStatus),
    updatedAt: damlTypes.Text.encode(__typed__.updatedAt),
  };
}
,
};



exports.CloseCampaign = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({closedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    closedAt: damlTypes.Text.encode(__typed__.closedAt),
  };
}
,
};



exports.DrawRaffleWinner = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({user: damlTypes.Party.decoder, claimId: damlTypes.Text.decoder, rewardCode: damlTypes.Text.decoder, drawnAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    user: damlTypes.Party.encode(__typed__.user),
    claimId: damlTypes.Text.encode(__typed__.claimId),
    rewardCode: damlTypes.Text.encode(__typed__.rewardCode),
    drawnAt: damlTypes.Text.encode(__typed__.drawnAt),
  };
}
,
};



exports.ClaimFcfsSlot = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({user: damlTypes.Party.decoder, claimId: damlTypes.Text.decoder, claimedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    user: damlTypes.Party.encode(__typed__.user),
    claimId: damlTypes.Text.encode(__typed__.claimId),
    claimedAt: damlTypes.Text.encode(__typed__.claimedAt),
  };
}
,
};



exports.QuestCampaign = damlTypes.assembleTemplate(
{
  templateId: '#canquest-v11:Main:QuestCampaign',
  templateIdWithPackageId: '1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd:Main:QuestCampaign',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({admin: damlTypes.Party.decoder, campaignId: damlTypes.Text.decoder, title: damlTypes.Text.decoder, questKind: damlTypes.Text.decoder, rewardCc: damlTypes.Numeric(10).decoder, claimFeeCc: damlTypes.Numeric(10).decoder, maxWinners: damlTypes.Int.decoder, currentClaims: damlTypes.Int.decoder, status: damlTypes.Text.decoder, createdAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    admin: damlTypes.Party.encode(__typed__.admin),
    campaignId: damlTypes.Text.encode(__typed__.campaignId),
    title: damlTypes.Text.encode(__typed__.title),
    questKind: damlTypes.Text.encode(__typed__.questKind),
    rewardCc: damlTypes.Numeric(10).encode(__typed__.rewardCc),
    claimFeeCc: damlTypes.Numeric(10).encode(__typed__.claimFeeCc),
    maxWinners: damlTypes.Int.encode(__typed__.maxWinners),
    currentClaims: damlTypes.Int.encode(__typed__.currentClaims),
    status: damlTypes.Text.encode(__typed__.status),
    createdAt: damlTypes.Text.encode(__typed__.createdAt),
  };
}
,
  ClaimFcfsSlot: {
    template: function () { return exports.QuestCampaign; },
    choiceName: 'ClaimFcfsSlot',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.ClaimFcfsSlot.decoder; }),
    argumentEncode: function (__typed__) { return exports.ClaimFcfsSlot.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(damlTypes.ContractId(exports.QuestCampaign), damlTypes.ContractId(exports.QuestClaim)).decoder; }),
    resultEncode: function (__typed__) { return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(damlTypes.ContractId(exports.QuestCampaign), damlTypes.ContractId(exports.QuestClaim)).encode(__typed__); },
  },
  DrawRaffleWinner: {
    template: function () { return exports.QuestCampaign; },
    choiceName: 'DrawRaffleWinner',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.DrawRaffleWinner.decoder; }),
    argumentEncode: function (__typed__) { return exports.DrawRaffleWinner.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(damlTypes.ContractId(exports.QuestCampaign), damlTypes.ContractId(exports.QuestClaim)).decoder; }),
    resultEncode: function (__typed__) { return pkg5aee9b21b8e9a4c4975b5f4c4198e6e6e8469df49e2010820e792f393db870f4.DA.Types.Tuple2(damlTypes.ContractId(exports.QuestCampaign), damlTypes.ContractId(exports.QuestClaim)).encode(__typed__); },
  },
  CloseCampaign: {
    template: function () { return exports.QuestCampaign; },
    choiceName: 'CloseCampaign',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.CloseCampaign.decoder; }),
    argumentEncode: function (__typed__) { return exports.CloseCampaign.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.QuestCampaign).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.QuestCampaign).encode(__typed__); },
  },
  UpdateCampaignStatus: {
    template: function () { return exports.QuestCampaign; },
    choiceName: 'UpdateCampaignStatus',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.UpdateCampaignStatus.decoder; }),
    argumentEncode: function (__typed__) { return exports.UpdateCampaignStatus.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.QuestCampaign).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.QuestCampaign).encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.QuestCampaign; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.QuestCampaign, ['1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd', '#canquest-v11']);



exports.ConfirmWalletActive = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({confirmedAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    confirmedAt: damlTypes.Text.encode(__typed__.confirmedAt),
  };
}
,
};



exports.WalletRegistration = damlTypes.assembleTemplate(
{
  templateId: '#canquest-v11:Main:WalletRegistration',
  templateIdWithPackageId: '1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd:Main:WalletRegistration',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({admin: damlTypes.Party.decoder, userAddress: damlTypes.Party.decoder, username: damlTypes.Text.decoder, partyId: damlTypes.Text.decoder, inviteCode: damlTypes.Text.decoder, registeredAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    admin: damlTypes.Party.encode(__typed__.admin),
    userAddress: damlTypes.Party.encode(__typed__.userAddress),
    username: damlTypes.Text.encode(__typed__.username),
    partyId: damlTypes.Text.encode(__typed__.partyId),
    inviteCode: damlTypes.Text.encode(__typed__.inviteCode),
    registeredAt: damlTypes.Text.encode(__typed__.registeredAt),
  };
}
,
  ConfirmWalletActive: {
    template: function () { return exports.WalletRegistration; },
    choiceName: 'ConfirmWalletActive',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.ConfirmWalletActive.decoder; }),
    argumentEncode: function (__typed__) { return exports.ConfirmWalletActive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.WalletRegistration).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.WalletRegistration).encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.WalletRegistration; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.WalletRegistration, ['1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd', '#canquest-v11']);



exports.UpdateUsername = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({newUsername: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    newUsername: damlTypes.Text.encode(__typed__.newUsername),
  };
}
,
};



exports.DebitPoints = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({amount: damlTypes.Int.decoder, reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    amount: damlTypes.Int.encode(__typed__.amount),
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.RewardPoints = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({pointsToAdd: damlTypes.Int.decoder, reason: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    pointsToAdd: damlTypes.Int.encode(__typed__.pointsToAdd),
    reason: damlTypes.Text.encode(__typed__.reason),
  };
}
,
};



exports.UserAccount = damlTypes.assembleTemplate(
{
  templateId: '#canquest-v11:Main:UserAccount',
  templateIdWithPackageId: '1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd:Main:UserAccount',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({admin: damlTypes.Party.decoder, userAddress: damlTypes.Party.decoder, username: damlTypes.Text.decoder, earnedPoints: damlTypes.Int.decoder, spentPoints: damlTypes.Int.decoder, createdAt: damlTypes.Text.decoder, }); }),
  encode: function (__typed__) {
  return {
    admin: damlTypes.Party.encode(__typed__.admin),
    userAddress: damlTypes.Party.encode(__typed__.userAddress),
    username: damlTypes.Text.encode(__typed__.username),
    earnedPoints: damlTypes.Int.encode(__typed__.earnedPoints),
    spentPoints: damlTypes.Int.encode(__typed__.spentPoints),
    createdAt: damlTypes.Text.encode(__typed__.createdAt),
  };
}
,
  RewardPoints: {
    template: function () { return exports.UserAccount; },
    choiceName: 'RewardPoints',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.RewardPoints.decoder; }),
    argumentEncode: function (__typed__) { return exports.RewardPoints.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.UserAccount).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.UserAccount).encode(__typed__); },
  },
  DebitPoints: {
    template: function () { return exports.UserAccount; },
    choiceName: 'DebitPoints',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.DebitPoints.decoder; }),
    argumentEncode: function (__typed__) { return exports.DebitPoints.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.UserAccount).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.UserAccount).encode(__typed__); },
  },
  UpdateUsername: {
    template: function () { return exports.UserAccount; },
    choiceName: 'UpdateUsername',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.UpdateUsername.decoder; }),
    argumentEncode: function (__typed__) { return exports.UpdateUsername.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.ContractId(exports.UserAccount).decoder; }),
    resultEncode: function (__typed__) { return damlTypes.ContractId(exports.UserAccount).encode(__typed__); },
  },
  Archive: {
    template: function () { return exports.UserAccount; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.UserAccount, ['1a5287bece66272f531393eddb4e1ae2b8407594cf0df27786fbd920e5f094dd', '#canquest-v11']);

