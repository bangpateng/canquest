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

var Splice_AmuletConfig = require('../../Splice/AmuletConfig/module');
var Splice_Types = require('../../Splice/Types/module');


exports.ExternalPartyConfigState = damlTypes.assembleTemplate(
{
  templateId: '#splice-amulet:Splice.ExternalPartyConfigState:ExternalPartyConfigState',
  templateIdWithPackageId: 'a31be0483f3175647053f28965a4e6d97e3dbc433ea2338be303fae69bbcff6a:Splice.ExternalPartyConfigState:ExternalPartyConfigState',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({dso: damlTypes.Party.decoder, holdingFeesOpenRoundNumber: Splice_Types.Round.decoder, amuletPrice: damlTypes.Numeric(10).decoder, transferConfig: Splice_AmuletConfig.TransferConfigV2(Splice_AmuletConfig.USD).decoder, targetArchiveAfter: damlTypes.Time.decoder, }); }),
  encode: function (__typed__) {
  return {
    dso: damlTypes.Party.encode(__typed__.dso),
    holdingFeesOpenRoundNumber: Splice_Types.Round.encode(__typed__.holdingFeesOpenRoundNumber),
    amuletPrice: damlTypes.Numeric(10).encode(__typed__.amuletPrice),
    transferConfig: Splice_AmuletConfig.TransferConfigV2(Splice_AmuletConfig.USD).encode(__typed__.transferConfig),
    targetArchiveAfter: damlTypes.Time.encode(__typed__.targetArchiveAfter),
  };
}
,
  Archive: {
    template: function () { return exports.ExternalPartyConfigState; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
}

);


damlTypes.registerTemplate(exports.ExternalPartyConfigState, ['a31be0483f3175647053f28965a4e6d97e3dbc433ea2338be303fae69bbcff6a', '#splice-amulet']);

