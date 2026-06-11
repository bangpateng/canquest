// Generated from Splice/AmuletAllocation.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f from '@daml.js/splice-api-token-metadata-v1-1.0.0';
import * as pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b from '@daml.js/splice-api-token-holding-v1-1.0.0';
import * as pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d from '@daml.js/splice-api-token-allocation-v1-1.0.0';
import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';

import * as Splice_Amulet from '../../Splice/Amulet/module';

export declare type AmuletAllocation_DsoExpire = {
  expireLock: boolean;
};

export declare const AmuletAllocation_DsoExpire:
  damlTypes.Serializable<AmuletAllocation_DsoExpire> & {
  }
;


export declare type AmuletAllocation = {
  lockedAmulet: damlTypes.ContractId<Splice_Amulet.LockedAmulet>;
  allocation: pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.AllocationSpecification;
};

export declare interface AmuletAllocationInterface {
  Archive: damlTypes.Choice<AmuletAllocation, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AmuletAllocation, undefined>>;
  AmuletAllocation_DsoExpire: damlTypes.Choice<AmuletAllocation, AmuletAllocation_DsoExpire, AmuletAllocation_DsoExpireResult, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<AmuletAllocation, undefined>>;
}
export declare const AmuletAllocation:
  damlTypes.Template<AmuletAllocation, undefined, '#splice-amulet:Splice.AmuletAllocation:AmuletAllocation'> &
  damlTypes.ToInterface<AmuletAllocation, pkg93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d.Splice.Api.Token.AllocationV1.Allocation> &
  AmuletAllocationInterface;

export declare namespace AmuletAllocation {
}



export declare type AmuletAllocation_DsoExpireResult = {
  senderHoldingCids: damlTypes.ContractId<pkg718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b.Splice.Api.Token.HoldingV1.Holding>[];
  meta: pkg4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f.Splice.Api.Token.MetadataV1.Metadata;
};

export declare const AmuletAllocation_DsoExpireResult:
  damlTypes.Serializable<AmuletAllocation_DsoExpireResult> & {
  }
;

