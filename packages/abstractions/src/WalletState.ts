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
import * as Brand from 'effect/Brand';
import * as Schema from 'effect/Schema';

/**
 * A branded `string` representing serialized (JSON) wallet state made up of local state, transaction history,
 * and block height.
 */
export type WalletState = Brand.Branded<string, 'WalletState'>;

/**
 * Constructs a branded `string` representing serialized (JSON) wallet state.
 */
export const WalletState = Brand.nominal<WalletState>();

/**
 * A schema that transforms a string into a {@link WalletState}.
 */
export const WalletStateSchema = Schema.String.pipe(Schema.fromBrand(WalletState));

/**
 * A type predicate that determines if a given value is a {@link WalletState}.
 *
 * @param u The value to test.
 * @returns `true` if `u` has the type {@link WalletState}.
 */
export const is = Schema.is(WalletStateSchema);
