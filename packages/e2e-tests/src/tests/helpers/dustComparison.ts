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
//
// Comparing one wallet's dust against another's. Two suites need it — the projections-vs-events comparison on a
// ledger-v9 chain, and the hard-fork lane's crossing from event sync into projections sync — and a wallet that
// disagreed with its twin in only one of them would be a finding either suite could miss, so the comparison lives in
// one place rather than in each.
import { Array as Arr } from 'effect';
import { type FacadeState } from '@midnightntwrk/wallet-sdk-facade';

/**
 * The dust state a facade emission carries is whichever variant produced it, so this reads the union rather than
 * ledger-v9's class by name. Both versions declare everything compared here.
 */
export type SyncedDustState = FacadeState['dust']['state']['state'];

/** One dust UTxO as its wallet's ledger version reports it. */
export type SyncedDustUtxo = SyncedDustState['utxos'][number];

/** JSON with bigints written out, so two structurally equal readings compare as strings. */
export const stringifyWithBigInts = (value: unknown): string =>
  JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));

/** Set equality under a caller-supplied element equality: same length, and neither side has anything the other lacks. */
export const sameItems = <T>(
  left: readonly T[],
  right: readonly T[],
  equal: (leftItem: T, rightItem: T) => boolean,
): boolean =>
  left.length === right.length &&
  Arr.differenceWith<T>(equal)(left, right).length === 0 &&
  Arr.differenceWith<T>(equal)(right, left).length === 0;

export const rootsEqual = (state1: SyncedDustState, state2: SyncedDustState): boolean =>
  state1.commitmentTreeRoot() === state2.commitmentTreeRoot() &&
  state1.generatingTreeRoot() === state2.generatingTreeRoot();

/** Two wallets hold the same dust, down to every field of every UTxO, and agree on both tree roots. */
export const dustStatesEqual = (state1: SyncedDustState, state2: SyncedDustState): boolean =>
  rootsEqual(state1, state2) &&
  sameItems(state1.utxos, state2.utxos, (utxo1, utxo2) => stringifyWithBigInts(utxo1) === stringifyWithBigInts(utxo2));

/**
 * What names a dust coin rather than where it sits.
 *
 * @remarks
 *   Across a hard fork the two things are not the same question. `backingNight`, `initialValue` and `ctime` are what the
 *   coin _is_ — they come from the Night that generates it and the moment generation began — while `mtIndex` and `seq`
 *   describe its position in a tree and its place in a spend chain, both of which a wallet learns from whichever source
 *   it syncs by. Comparing two wallets on the first three asks whether they hold the same dust; comparing them on all
 *   of it also asks whether they arrived by the same route, which is precisely what a crossing test must not require.
 */
export const dustCoinIdentity = (
  utxo: SyncedDustUtxo,
): Readonly<{ backingNight: string; initialValue: bigint; ctime: Date }> => ({
  backingNight: utxo.backingNight,
  initialValue: utxo.initialValue,
  ctime: utxo.ctime,
});

/** Two wallets hold the same dust coins, whatever route each took to them. */
export const sameDustCoins = (state1: SyncedDustState, state2: SyncedDustState): boolean =>
  sameItems(
    state1.utxos,
    state2.utxos,
    (utxo1, utxo2) => stringifyWithBigInts(dustCoinIdentity(utxo1)) === stringifyWithBigInts(dustCoinIdentity(utxo2)),
  );
