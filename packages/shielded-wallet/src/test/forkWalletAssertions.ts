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

import { ProtocolVersion, WalletTransaction, type AnyTx } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either } from 'effect';
import { type CoreWallet as PreForkWallet } from '../v1/CoreWallet.js';
import { type CoreWallet as PostForkWallet } from '../v2/CoreWallet.js';

/** A wallet on either side of the boundary. */
export type EitherWallet = PreForkWallet | PostForkWallet;

/**
 * The transaction a handle carries, read at the epoch its own stamp names.
 *
 * @remarks
 *   A test assertion is entitled to look inside, and this is the only place these suites do. The result type is the
 *   caller's to name, which is exactly the choice the stamp has already settled — so a suite that names the wrong
 *   ledger version is making a claim the surrounding assertions will refute.
 * @param handle The handle to read.
 * @param forkVersion The boundary the epoch is measured against.
 * @returns The carried transaction.
 */
export const carried = <T>(handle: AnyTx, forkVersion: ProtocolVersion.ProtocolVersion): T =>
  Either.getOrThrow(
    WalletTransaction.unwrapWithin<T>(handle, ProtocolVersion.epochOf(handle.protocolVersion, forkVersion)),
  );

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
 *   state is how a proof states that what the wallet carried across the boundary is the tree the ledger translation
 *   produced — not merely a tree with the same leaves in it.
 */
export const merkleRoot = (wallet: EitherWallet): bigint | undefined => wallet.state.merkleTreeRoot;

/**
 * Whether the wallet's coin hashes are still waiting to be computed.
 *
 * @remarks
 *   Only a wallet of the post-fork ledger version can be waiting — the pre-fork variant is never on the receiving end of
 *   a crossing — so this reads the union by asking, which narrows to the side that has the field. Set by the
 *   cross-ledger migration, which holds no secret keys, and cleared by the first sync update, which carries them; its
 *   absence on a wallet holding coins is how a proof states that the crossing finished rather than merely started.
 */
export const awaitingCoinHashes = (wallet: EitherWallet): boolean =>
  'coinHashesPending' in wallet && wallet.coinHashesPending === true;

/** A coin the wallet is expecting but has not seen on chain yet, as plain data both ledger versions express alike. */
export type ExpectedCoin = Readonly<{ commitment: string; nonce: string; value: bigint }>;

/**
 * The coins the wallet is still waiting for — its `pendingOutputs` — ascending by commitment.
 *
 * @remarks
 *   A wallet that has built a transaction paying itself, or taken change out of one, is expecting an output it cannot yet
 *   see: the commitment is known, the leaf is not on chain. That expectation is part of what a wallet owns, and nothing
 *   on the far side of a fork re-announces it, so a crossing that dropped it would silently cost the wallet every coin
 *   it was about to receive.
 */
export const expectedCoins = (wallet: EitherWallet): readonly ExpectedCoin[] =>
  [...wallet.state.pendingOutputs.entries()]
    .map(([commitment, [coin]]) => ({ commitment, nonce: coin.nonce, value: coin.value }))
    .sort((left, right) => (left.commitment < right.commitment ? -1 : left.commitment > right.commitment ? 1 : 0));
