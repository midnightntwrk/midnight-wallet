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
import { DustLocalState } from '@midnight-ntwrk/ledger-v8';
import { DustLocalState as RcDustLocalState, type DustNullifier } from '@midnight-ntwrk/ledger-v8-rc';
import { HashMap } from 'effect';
import {
  type CollapsedMerkleTree,
  type DustGenerationDtimUpdate,
  type DustUtxoEntry,
  type DustUtxoMap,
  type NewDustGeneration,
} from './SyncSchema.js';

// The projections sync needs ledger 8.2.0-rc.1 state operations (updateGenerationTreeFromEvidence, the
// *FirstFree/nullifiers accessors), but the dust wallet holds its state as an 8.1.0 WASM instance. Instances cannot
// cross between the two loaded WASM modules, so the state is carried over the boundary as serialized bytes — the
// wire format is identical in both versions.

export const toRcState = (state: DustLocalState): RcDustLocalState => RcDustLocalState.deserialize(state.serialize());

export const toBaseState = (state: RcDustLocalState): DustLocalState => DustLocalState.deserialize(state.serialize());

export const applyDustGenerations = (
  initialState: RcDustLocalState,
  dustCollapsedGenTreeSnapshot: ReadonlyArray<CollapsedMerkleTree>, // a full snapshot starting from index 0
  newGenerations: ReadonlyArray<NewDustGeneration>,
  generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
): RcDustLocalState => {
  // apply snapshot updates covering (lastIndex, nextGenerationIndex) — the gap before the next own generation,
  // or every remaining update when there is no next generation
  const applySnapshotGap = (
    state: RcDustLocalState,
    lastIndex: number,
    nextGenerationIndex?: number,
  ): RcDustLocalState =>
    dustCollapsedGenTreeSnapshot
      .filter(
        ({ startIndex, endIndex }) =>
          startIndex > lastIndex && (nextGenerationIndex === undefined || endIndex < nextGenerationIndex),
      )
      .reduce((current, update) => current.applyGenerationCollapsedUpdate(update.update), state);

  const { state: stateWithGenerations, lastIndex } = newGenerations.reduce(
    (acc, { generationMtIndex, genInfo, qdo }) => ({
      state: applySnapshotGap(acc.state, acc.lastIndex, generationMtIndex).insertGenerationInfo(
        BigInt(generationMtIndex),
        genInfo,
        qdo.backingNight,
      ),
      lastIndex: generationMtIndex,
    }),
    { state: initialState, lastIndex: -1 },
  );

  // apply the rest of the updates, then the dtime updates
  return generationDtimeUpdates.reduce(
    (state, update) => state.updateGenerationTreeFromEvidence(update.treeInsertionPath),
    applySnapshotGap(stateWithGenerations, lastIndex),
  );
};

export const applyNewDustUtxos = (
  initialState: RcDustLocalState,
  newDustUtxos: Readonly<DustUtxoMap>,
): RcDustLocalState =>
  [...newDustUtxos]
    .toSorted((a, b) => Number(a[1].qdo.mtIndex - b[1].qdo.mtIndex))
    .reduce((state, [dustNullifier, utxoInfo]) => state.addUtxo(dustNullifier, utxoInfo.qdo), initialState);

export const applyDustCommitments = (
  initialState: RcDustLocalState,
  newDustUtxos: Readonly<DustUtxoMap>,
  collapsedCommitments: ReadonlyArray<CollapsedMerkleTree>,
): RcDustLocalState => {
  const newUtxos = [...HashMap.values(newDustUtxos)].toSorted((a, b) => Number(a.qdo.mtIndex - b.qdo.mtIndex));

  const insertCommitments = (state: RcDustLocalState, utxos: ReadonlyArray<DustUtxoEntry>): RcDustLocalState =>
    utxos.reduce((current, utxoInfo) => current.insertCommitment(utxoInfo.qdo.mtIndex, utxoInfo.qdo, true), state);

  const stateAfterCollapsed = collapsedCommitments.reduce((state, { startIndex, update }) => {
    // apply utxos going before the current index, then the current update
    const priorUtxos = newUtxos.filter(
      (utxoInfo) => Number(utxoInfo.qdo.mtIndex) < startIndex && utxoInfo.qdo.mtIndex >= state.commitmentTreeFirstFree,
    );
    return insertCommitments(state, priorUtxos).applyCommitmentCollapsedUpdate(update);
  }, initialState);

  // insert the utxos after the last collapsed update — all of them when there were no collapsed updates
  const lastCollapsedIndex = collapsedCommitments.at(-1);
  return insertCommitments(
    stateAfterCollapsed,
    lastCollapsedIndex !== undefined
      ? newUtxos.filter((utxoInfo) => Number(utxoInfo.qdo.mtIndex) > lastCollapsedIndex.endIndex)
      : newUtxos,
  );
};

export const applySpentNullifiers = (
  initialState: RcDustLocalState,
  spentNullifiers: ReadonlyArray<DustNullifier>,
): RcDustLocalState => spentNullifiers.reduce((state, nullifier) => state.removeUtxo(nullifier), initialState);
