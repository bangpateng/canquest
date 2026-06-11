// Generated from Splice/Wallet/TopUpState.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';

import * as pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69 from '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';

export declare type ValidatorTopUpState = {
  dso: damlTypes.Party;
  validator: damlTypes.Party;
  memberId: string;
  synchronizerId: string;
  migrationId: damlTypes.Int;
  lastPurchasedAt: damlTypes.Time;
};

export declare interface ValidatorTopUpStateInterface {
  Archive: damlTypes.Choice<ValidatorTopUpState, pkg9e70a8b3510d617f8a136213f33d6a903a10ca0eeec76bb06ba55d1ed9680f69.DA.Internal.Template.Archive, {}, undefined> & damlTypes.ChoiceFrom<damlTypes.Template<ValidatorTopUpState, undefined>>;
}
export declare const ValidatorTopUpState:
  damlTypes.Template<ValidatorTopUpState, undefined, '#splice-wallet:Splice.Wallet.TopUpState:ValidatorTopUpState'> &
  damlTypes.ToInterface<ValidatorTopUpState, never> &
  ValidatorTopUpStateInterface;

export declare namespace ValidatorTopUpState {
}


