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
 * A branded `Uint8Array` that represents a BIP32 compatible seed phrase.
 */
export type WalletSeed = Brand.Branded<Uint8Array, 'WalletSeed'>;

/**
 * Constructs a branded `Uint8Array` representing a BIP32 compatible seed phrase.
 */
export const WalletSeed = Brand.nominal<WalletSeed>();

/**
 * A schema that transforms an array of numbers into a {@link WalletSeed}.
 */
export const WalletSeedSchema = Schema.Uint8Array.pipe(Schema.fromBrand(WalletSeed));

/**
 * A type predicate that determines if a given value is a {@link WalletSeed}.
 *
 * @param u The value to test.
 * @returns `true` if `u` has the type {@link WalletSeed}.
 */
export const is = Schema.is(WalletSeedSchema);

/**
 * Constructs a {@link WalletSeed} from a string representation of a BIP32 compatible seed phrase.
 *
 * @param strValue The string value.
 * @returns A {@link WalletSeed} created from `strValue`.
 */
export const fromString: (strValue: string) => WalletSeed = (strValue) => WalletSeed(Buffer.from(strValue, 'hex'));
