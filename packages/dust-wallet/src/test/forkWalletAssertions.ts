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
 * Reading a dust wallet's holdings without caring which ledger version holds them.
 *
 * @remarks
 *   A wallet crossing a fork is a `CoreWallet` of one ledger version before the boundary and of the other after it.
 *   Everything a fork proof asserts about its dust — how many UTXOs, at which Merkle indices, backed by which Night,
 *   worth what — is plain data that both versions express identically, so these read the union rather than being
 *   written twice.
 *
 *   Restricted on purpose to the members ledger-v8 and ledger-v9 both declare. `DustLocalState` gained
 *   `commitmentTreeFirstFree`, `generatingTreeFirstFree` and `nullifiers` in v9, so a fork proof cannot compare tree
 *   _sizes_ across the boundary the way the shielded proof compares `firstFree` — the pre-fork side has no such reading
 *   to offer. The tree roots are declared by both, and they are the stronger statement anyway.
 */

import { type CoreWallet as PreForkWallet } from '../v1/CoreWallet.js';
import { type CoreWallet as PostForkWallet } from '../v2/CoreWallet.js';

/** A dust wallet on either side of the boundary. */
export type EitherWallet = PreForkWallet | PostForkWallet;

/** Ascending order for bigints, which `Array.prototype.sort`'s default (string) comparison gets wrong. */
const ascending = (left: bigint, right: bigint): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * One dust UTXO, reduced to the fields that identify it.
 *
 * @remarks
 *   Every one of these is a value the ledger derived rather than the wallet chose: `nonce` from the backing Night nonce
 *   and the owner's key, `initialValue` from the Night value and the elapsed generation time, `mtIndex` from where the
 *   commitment landed. So a wallet that ends up holding an equal set of these is holding the same dust, not merely a
 *   similar amount of it.
 */
export type DustIdentity = Readonly<{
  nonce: bigint;
  initialValue: bigint;
  backingNight: string;
  ctime: number;
  mtIndex: bigint;
  owner: bigint;
}>;

const identify = (utxo: {
  nonce: bigint;
  initialValue: bigint;
  backingNight: string;
  ctime: Date;
  mtIndex: bigint;
  owner: bigint;
}): DustIdentity => ({
  nonce: utxo.nonce,
  initialValue: utxo.initialValue,
  backingNight: utxo.backingNight,
  ctime: utxo.ctime.getTime(),
  mtIndex: utxo.mtIndex,
  owner: utxo.owner,
});

/** The wallet's dust UTXOs, identified and ordered by Merkle index so two wallets are directly comparable. */
export const dustIdentities = (wallet: EitherWallet): readonly DustIdentity[] =>
  wallet.state.utxos.map(identify).sort((left, right) => ascending(left.mtIndex, right.mtIndex));

/** How many dust UTXOs the wallet holds. */
export const dustCount = (wallet: EitherWallet): number => wallet.state.utxos.length;

/** The Merkle indices the wallet's dust UTXOs occupy in the commitment tree, ascending. */
export const dustIndices = (wallet: EitherWallet): readonly bigint[] =>
  wallet.state.utxos.map((utxo) => utxo.mtIndex).sort(ascending);

/**
 * The root of the wallet's own dust commitment tree.
 *
 * @remarks
 *   The single value that says whether two wallets rebuilt the same tree rather than merely trees with the same leaves in
 *   them. Both ledger versions compute it, which is what makes it usable across the boundary.
 */
export const commitmentTreeRoot = (wallet: EitherWallet): bigint | undefined => wallet.state.commitmentTreeRoot();

/** The root of the wallet's dust generation tree — the Night-side half of the same statement. */
export const generationTreeRoot = (wallet: EitherWallet): bigint | undefined => wallet.state.generatingTreeRoot();

/**
 * Everything the wallet could pay fees with at `time`.
 *
 * @remarks
 *   Time-dependent, and that is the point: dust generates and decays, so a balance is only meaningful with the instant it
 *   was valued at. Both sides of a fork proof must be valued at the same instant for the comparison to mean anything.
 */
export const balanceAt = (wallet: EitherWallet, time: Date): bigint => wallet.state.walletBalance(time);
