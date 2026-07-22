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
import {
  DustSecretKey as BaseDustSecretKey,
  LedgerParameters as BaseLedgerParameters,
} from '@midnight-ntwrk/ledger-v8';
import { DustSecretKey, dustFirstNonce, dustNullifier } from '@midnight-ntwrk/ledger-v8-rc';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { CoreWallet } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { describe, expect, it } from 'vitest';
import { type NewDustGeneration, DustUtxoMap } from '../SyncSchema.js';
import {
  applyDustCommitments,
  applyDustGenerations,
  applyNewDustUtxos,
  applySpentNullifiers,
  toBaseState,
  toRcState,
} from '../StateOps.js';

const networkId = NetworkId.NetworkId.Undeployed;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';

// Characterization coverage for the pure state-apply functions used by the projections sync capability. The
// collapsed-update paths need indexer-produced merkle payloads and stay covered by the projections e2e suite.
describe('projections state apply functions', () => {
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
  const emptyState = () =>
    toRcState(
      CoreWallet.initEmpty(
        BaseLedgerParameters.initialParameters().dust,
        BaseDustSecretKey.fromSeed(Buffer.from(seedHex, 'hex')),
        networkId,
      ).state,
    );

  const generation = (backingNightByte: string, mtIndex: bigint, generationMtIndex: number): NewDustGeneration => {
    const backingNight = backingNightByte.repeat(32);
    const qdo = {
      initialValue: 1_000_000_000n,
      owner: secretKey.publicKey,
      nonce: dustFirstNonce(backingNight, secretKey.publicKey),
      seq: 0,
      ctime: new Date(1_000_000),
      backingNight,
      mtIndex,
    };
    return {
      dustNullifier: dustNullifier(qdo, secretKey),
      genInfo: { value: 5_000_000_000n, owner: secretKey.publicKey, nonce: backingNight, dtime: undefined },
      generationMtIndex,
      qdo,
      transactionId: 7,
      transactionHash: 'cd'.repeat(32),
    };
  };

  it('applies new utxos and their commitments, then removes spent nullifiers', () => {
    const state = emptyState();
    const generations = [generation('ab', 0n, 0), generation('ba', 1n, 1)];
    const utxoMap = DustUtxoMap.create(generations);

    const withUtxos = applyNewDustUtxos(state, utxoMap);
    const withCommitments = applyDustCommitments(withUtxos, utxoMap, []);

    expect(withCommitments.utxos).toHaveLength(2);
    expect(withCommitments.commitmentTreeFirstFree).toBe(2n);

    const afterSpend = applySpentNullifiers(withCommitments, [generations[0].dustNullifier]);
    expect(afterSpend.utxos).toHaveLength(1);
    expect(afterSpend.utxos[0].backingNight).toBe(generations[1].qdo.backingNight);
  });

  it('inserts generation info for new generations', () => {
    const state = emptyState();
    const generations = [generation('ab', 0n, 0), generation('ba', 1n, 1)];

    const withGenerations = applyDustGenerations(state, [], generations, []);

    expect(withGenerations.generatingTreeFirstFree).toBe(2n);
    expect(state.generatingTreeFirstFree).toBe(0n);
  });

  it('round-trips a state through both ledger modules without changing its serialized form', () => {
    const state = emptyState();
    const generations = [generation('ab', 0n, 0), generation('ba', 1n, 1)];
    const withUtxos = applyDustCommitments(
      applyNewDustUtxos(state, DustUtxoMap.create(generations)),
      DustUtxoMap.create(generations),
      [],
    );

    const baseState = toBaseState(withUtxos);
    const roundTripped = toRcState(baseState);

    expect(baseState.utxos).toHaveLength(2);
    expect(Buffer.from(roundTripped.serialize())).toEqual(Buffer.from(withUtxos.serialize()));
  });
});
