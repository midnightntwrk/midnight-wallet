// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
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
import { InsufficientDustForFeeError as V1InsufficientDustForFeeError } from './v1/WalletError.js';
import { InsufficientDustForFeeError as V2InsufficientDustForFeeError } from './v2/WalletError.js';

/**
 * Whether a rejection is the error a first-time registration raises when its generated dust cannot yet pay its fee.
 *
 * @remarks
 *   Each variant declares its own `InsufficientDustForFeeError`, so which class a rejection is depends on the variant
 *   running when it was raised; `instanceof` against either one alone misses the other. This recognises both.
 * @example
 *   ```ts
 *   await wallet.registerNightUtxosForDustGeneration(nightUtxos, verifyingKey, signData).catch((error: unknown) => {
 *   if (isInsufficientDustForFeeError(error)) console.warn(`short by ${error.shortfall} Specks`);
 *   throw error;
 *   });
 *   ```
 *
 * @param error The rejection to test.
 * @returns `true` for either variant's `InsufficientDustForFeeError`, narrowing `error` to it.
 */
export const isInsufficientDustForFeeError = (
  error: unknown,
): error is V1InsufficientDustForFeeError | V2InsufficientDustForFeeError =>
  error instanceof V1InsufficientDustForFeeError || error instanceof V2InsufficientDustForFeeError;
