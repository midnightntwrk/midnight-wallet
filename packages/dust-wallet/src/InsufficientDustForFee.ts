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
import { InsufficientDustForFeeError } from './types/DustWalletTypes.js';

/**
 * Whether a rejection is the error a first-time registration raises when its generated dust cannot yet pay its fee.
 *
 * @remarks
 *   Both variants raise the one {@link InsufficientDustForFeeError}, so this is `instanceof` against it, as a function a
 *   rejection handler can call on an `unknown`.
 * @example
 *   ```ts
 *   await wallet.registerNightUtxosForDustGeneration(nightUtxos, verifyingKey, signData).catch((error: unknown) => {
 *   if (isInsufficientDustForFeeError(error)) console.warn(`short by ${error.shortfall} Specks`);
 *   throw error;
 *   });
 *   ```
 *
 * @param error The rejection to test.
 * @returns `true` for an `InsufficientDustForFeeError`, narrowing `error` to it.
 */
export const isInsufficientDustForFeeError = (error: unknown): error is InsufficientDustForFeeError =>
  error instanceof InsufficientDustForFeeError;
