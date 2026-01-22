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
import { Imbalances, type TransactionCostModel } from '@midnight-ntwrk/wallet-sdk-capabilities';

export const ShieldedCostModel: TransactionCostModel = {
  inputFeeOverhead: 0n,
  outputFeeOverhead: 0n,
};

export type TransactionImbalances = Readonly<{
  guaranteed: Imbalances;
  fallible: Imbalances;
}>;
export const TransactionImbalances = new (class {
  empty = (): TransactionImbalances => {
    return {
      guaranteed: Imbalances.empty(),
      fallible: Imbalances.empty(),
    };
  };

  areBalanced = (imbalances: TransactionImbalances): boolean => {
    const areFallibleAllZeroes = imbalances.fallible.entries().every(([, value]) => value === 0n);

    const areGuaranteedAllZeroes = imbalances.guaranteed.entries().every(([, value]) => value === 0n);

    return areFallibleAllZeroes && areGuaranteedAllZeroes;
  };
})();
