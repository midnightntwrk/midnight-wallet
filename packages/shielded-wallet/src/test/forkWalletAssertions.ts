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
 * Reading a shielded wallet's coins without caring which ledger version holds them.
 *
 * @remarks
 *   A wallet crossing a fork is a `CoreWallet` of one ledger version before the boundary and of the other after it.
 *   Everything a fork proof asserts about coins — how many, worth what, at which Merkle indices — is plain data that
 *   both versions express identically, so these read the union rather than being written twice.
 */

import { type CoreWallet as PreForkWallet } from '../v1/CoreWallet.js';
import { type CoreWallet as PostForkWallet } from '../v2/CoreWallet.js';

/** A wallet on either side of the boundary. */
export type EitherWallet = PreForkWallet | PostForkWallet;

/** Ascending order for bigints, which `Array.prototype.sort`'s default (string) comparison gets wrong. */
export const ascending = (left: bigint, right: bigint): number => (left < right ? -1 : left > right ? 1 : 0);

const spendableCoins = (wallet: EitherWallet): readonly Readonly<{ value: bigint; mt_index: bigint }>[] => [
  ...wallet.state.coins,
];

/** The values of the wallet's spendable coins, ascending. */
export const coinValues = (wallet: EitherWallet): readonly bigint[] =>
  spendableCoins(wallet)
    .map((coin) => coin.value)
    .sort(ascending);

/** The Merkle indices the wallet's spendable coins occupy, ascending. */
export const coinIndices = (wallet: EitherWallet): readonly bigint[] =>
  spendableCoins(wallet)
    .map((coin) => coin.mt_index)
    .sort(ascending);

/** Everything the wallet can spend, summed. */
export const totalValue = (wallet: EitherWallet): bigint =>
  spendableCoins(wallet).reduce((sum, coin) => sum + coin.value, 0n);

/**
 * How far the wallet's local commitment tree reaches — its `firstFree`.
 *
 * Distinct from how many coins it holds: the tree also covers everybody else's commitments, which a wallet skips over
 * rather than stores. Comparing it to the chain's own tree size is how a proof states that the local tree was fully
 * reconstructed and not merely populated with the leaves the wallet cares about.
 */
export const treeSize = (wallet: EitherWallet): bigint => wallet.state.firstFree;

/**
 * The root of the wallet's own commitment tree.
 *
 * @remarks
 *   The single value that says whether a wallet's tree is the chain's tree. Comparing it to a root taken from a chain
 *   state is how a proof states that what the wallet rebuilt from replayed events is byte-for-byte the tree the ledger
 *   translation produced — not merely a tree with the same leaves in it.
 */
export const merkleRoot = (wallet: EitherWallet): bigint | undefined => wallet.state.merkleTreeRoot;
