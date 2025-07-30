/* eslint-disable */
/**
 * Auto-generated with scripts/generate-types.ts
 * Then manually modified to only expose types and endpoints of interest
 */

// import type lookup before we augment - in some environments
// this is required to allow for ambient/previous definitions
import '@polkadot/api-base/types/errors';

import type { ApiTypes, AugmentedError } from '@polkadot/api-base/types';

export type __AugmentedError<ApiType extends ApiTypes> = AugmentedError<ApiType>;

declare module '@polkadot/api-base/types/errors' {
  interface AugmentedErrors<ApiType extends ApiTypes> {
    midnight: {
      ContractCallCostError: AugmentedError<ApiType>;
      Deserialization: AugmentedError<ApiType>;
      LedgerCacheError: AugmentedError<ApiType>;
      LedgerStateScaleDecodingError: AugmentedError<ApiType>;
      NewStateOutOfBounds: AugmentedError<ApiType>;
      NoLedgerState: AugmentedError<ApiType>;
      Serialization: AugmentedError<ApiType>;
      Transaction: AugmentedError<ApiType>;
    };
  } // AugmentedErrors
} // declare module
