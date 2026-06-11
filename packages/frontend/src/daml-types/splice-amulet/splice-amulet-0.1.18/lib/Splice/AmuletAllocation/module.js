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

var pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f = require('@daml.js/splice-api-token-metadata-v1-1.0.0');
var pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b = require('@daml.js/splice-api-token-holding-v1-1.0.0');
var pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d = require('@daml.js/splice-api-token-allocation-v1-1.0.0');
var pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 = require('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0');

var Splice_Amulet = require('../../Splice/Amulet/module');


exports.AmuletAllocation_DsoExpire = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({expireLock: damlTypes.Bool.decoder, }); }),
  encode: function (__typed__) {
  return {
    expireLock: damlTypes.Bool.encode(__typed__.expireLock),
  };
}
,
};



exports.AmuletAllocation = damlTypes.assembleTemplate(
{
  templateId: '#splice-amulet:Splice.AmuletAllocation:AmuletAllocation',
  templateIdWithPackageId: 'a31be0483f3175647053f28965a4e6d97e3dbc433ea2338be303fae69bbcff6a:Splice.AmuletAllocation:AmuletAllocation',
  keyDecoder: damlTypes.lazyMemo(function () { return jtv.constant(undefined); }),
  keyEncode: function () { throw 'EncodeError'; },
  decoder: damlTypes.lazyMemo(function () { return jtv.object({lockedAmulet: damlTypes.ContractId(Splice_Amulet.LockedAmulet).decoder, allocation: pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.AllocationSpecification.decoder, }); }),
  encode: function (__typed__) {
  return {
    lockedAmulet: damlTypes.ContractId(Splice_Amulet.LockedAmulet).encode(__typed__.lockedAmulet),
    allocation: pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.AllocationSpecification.encode(__typed__.allocation),
  };
}
,
  Archive: {
    template: function () { return exports.AmuletAllocation; },
    choiceName: 'Archive',
    argumentDecoder: damlTypes.lazyMemo(function () { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.decoder; }),
    argumentEncode: function (__typed__) { return pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return damlTypes.Unit.decoder; }),
    resultEncode: function (__typed__) { return damlTypes.Unit.encode(__typed__); },
  },
  AmuletAllocation_DsoExpire: {
    template: function () { return exports.AmuletAllocation; },
    choiceName: 'AmuletAllocation_DsoExpire',
    argumentDecoder: damlTypes.lazyMemo(function () { return exports.AmuletAllocation_DsoExpire.decoder; }),
    argumentEncode: function (__typed__) { return exports.AmuletAllocation_DsoExpire.encode(__typed__); },
    resultDecoder: damlTypes.lazyMemo(function () { return exports.AmuletAllocation_DsoExpireResult.decoder; }),
    resultEncode: function (__typed__) { return exports.AmuletAllocation_DsoExpireResult.encode(__typed__); },
  },
}

, pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation
);


damlTypes.registerTemplate(exports.AmuletAllocation, ['a31be0483f3175647053f28965a4e6d97e3dbc433ea2338be303fae69bbcff6a', '#splice-amulet']);



exports.AmuletAllocation_DsoExpireResult = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({senderHoldingCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).decoder, meta: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.Metadata.decoder, }); }),
  encode: function (__typed__) {
  return {
    senderHoldingCids: damlTypes.List(damlTypes.ContractId(pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding)).encode(__typed__.senderHoldingCids),
    meta: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.Metadata.encode(__typed__.meta),
  };
}
,
};

