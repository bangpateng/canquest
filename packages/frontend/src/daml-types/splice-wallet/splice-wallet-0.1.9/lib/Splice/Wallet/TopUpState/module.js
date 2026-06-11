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


exports.ValidatorTopUpState = damlTypes.assembleTemplate(
{
  templateId: '#splice-wallet:Splice.Wallet.TopUpState:ValidatorTopUpState',
  templateIdWithPackageId: '940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5:Splice.Wallet.TopUpState:ValidatorTopUpState',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({dso: damlTypes.Party.decoder, validator: damlTypes.Party.decoder, memberId: damlTypes.Text.decoder, synchronizerId: damlTypes.Text.decoder, migrationId: damlTypes.Int.decoder, lastPurchasedAt: damlTypes.Time.decoder, }); }),
  encode: function (__typed__) {
  return {
    dso: damlTypes.Party.encode(__typed__.dso),
    validator: damlTypes.Party.encode(__typed__.validator),
    memberId: damlTypes.Text.encode(__typed__.memberId),
    synchronizerId: damlTypes.Text.encode(__typed__.synchronizerId),
    migrationId: damlTypes.Int.encode(__typed__.migrationId),
    lastPurchasedAt: damlTypes.Time.encode(__typed__.lastPurchasedAt),
  };
}
,
  Archive: {
    template: function () { return exports.ValidatorTopUpState; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.ValidatorTopUpState, ['940b9fd181c0cf358dd8c38934a8c908d2a3ee5a4728f72481b4de6720f3f8d5', '#splice-wallet']);

