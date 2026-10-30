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
import { type TokenType } from './TokenType.js';

/**
 * An unshielded UTxO, as the SDK names it whichever ledger version reported it.
 *
 * @remarks
 *   Declared here rather than in either wallet that reads one, because two do: the unshielded wallet holds them, and the
 *   dust wallet registers Night UTxOs for dust generation. It is plain data — an amount, an address, a token type and
 *   an output reference — and byte-for-byte the same on either side of a protocol boundary, which is why both ledger
 *   versions' `Utxo` are assignable to it and neither has to be named to hold one.
 */
export type UnshieldedUtxo = {
  /** The amount, in the token's smallest unit. */
  value: bigint;
  /** The owner's address, as hexadecimal. */
  owner: string;
  /** The token type the amount is in. */
  type: TokenType;
  /** The hash of the intent that created this output, as hexadecimal. */
  intentHash: string;
  /** The output's position within that intent. */
  outputNo: number;
};
