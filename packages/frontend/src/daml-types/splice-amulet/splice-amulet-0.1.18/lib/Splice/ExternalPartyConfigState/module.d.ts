// Generated from Splice/ExternalPartyConfigState.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';

import * as Splice_AmuletConfig from '../../Splice/AmuletConfig/module';
import * as Splice_Types from '../../Splice/Types/module';

export declare type ExternalPartyConfigState = {
  dso: damlTypes.Party;
  holdingFeesOpenRoundNumber: Splice_Types.Round;
  amuletPrice: damlTypes.Numeric;
  transferConfig: Splice_AmuletConfig.TransferConfigV2<Splice_AmuletConfig.USD>;
  targetArchiveAfter: damlTypes.Time;
};

export declare interface ExternalPartyConfigStateInterface {
  Archive: damlTypes.Choice<ExternalPartyConfigState, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<ExternalPartyConfigState, undefined>>;
}
export declare const ExternalPartyConfigState:
  damlTypes.Template<ExternalPartyConfigState, undefined, '#splice-amulet:Splice.ExternalPartyConfigState:ExternalPartyConfigState'> &
  damlTypes.ToInterface<ExternalPartyConfigState, never> &
  ExternalPartyConfigStateInterface;

export declare namespace ExternalPartyConfigState {
}


