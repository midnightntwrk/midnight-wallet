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

/**
 * Block identity and timing for a simulated chain — how a block is hashed and what context it is executed against.
 *
 * Neither depends on the ledger a chain runs, so both are shared by every simulator.
 */

import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';

/**
 * The context a block is executed against.
 *
 * Structurally the ledger's own `BlockContext`, which is a plain record and is defined identically by ledger-v8 and
 * ledger-v9 — so it is stated once here and a value of this type is accepted by either ledger.
 */
export type BlockContext = Readonly<{
  /** Hash of the parent block */
  parentBlockHash: string;
  /** Seconds elapsed since the UNIX epoch */
  secondsSinceEpoch: bigint;
  /** Maximum expected error on {@link secondsSinceEpoch}, as a positive number of seconds */
  secondsSinceEpochErr: number;
  /** Seconds since the previous block */
  lastBlockTime: bigint;
}>;

/** The part of a produced block that block timing needs — its height and when it was produced. */
export type PreviousBlock = Readonly<{
  number: bigint;
  timestamp: Date;
}>;

/**
 * Compute block hash from block number. Uses a deterministic hash based on block number for easy recomputation.
 *
 * @param blockNumber - The block number to compute hash for
 * @returns A deterministic 64-character hex hash
 */
export const blockHash = async (blockNumber: bigint): Promise<string> => {
  const input = `block-${blockNumber.toString()}`;
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const { Encoding } = await import('effect');
  return Encoding.encodeHex(new Uint8Array(hashBuffer));
};

/**
 * Create the next block context from the previous block.
 *
 * @param previousBlock - The previous block (or undefined for genesis)
 * @param blockTime - The timestamp for the new block
 * @param blockNumber - Height of the new block, overriding the height derived from `previousBlock`. Needed for a
 *   genesis block that continues an existing chain's numbering, as a post-fork chain's does.
 * @returns A BlockContext suitable for transaction processing
 */
export const nextBlockContextFromBlock = async (
  previousBlock: PreviousBlock | undefined,
  blockTime: Date,
  blockNumber?: bigint,
): Promise<BlockContext> => {
  const nextBlockNumber = blockNumber ?? (previousBlock !== undefined ? previousBlock.number + 1n : 0n);
  const hash = await blockHash(nextBlockNumber);
  const blockSeconds = DateOps.dateToSeconds(blockTime);
  const previousSeconds =
    previousBlock !== undefined ? DateOps.dateToSeconds(previousBlock.timestamp) : blockSeconds - 1n;
  const timeSinceLastBlock = blockSeconds - previousSeconds;

  return {
    parentBlockHash: hash,
    secondsSinceEpoch: blockSeconds,
    secondsSinceEpochErr: 1, // Clock error tolerance in seconds (reasonable default for simulator)
    lastBlockTime: timeSinceLastBlock > 0n ? timeSinceLastBlock : 1n,
  };
};
