// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
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
