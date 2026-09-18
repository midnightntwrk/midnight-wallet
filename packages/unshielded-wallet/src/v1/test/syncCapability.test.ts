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
// The per-message boundary rule. Unshielded sync is message-at-a-time, not batched: there is no prefix to apply and no
// suffix to defer, only the question "does this one transaction belong to this variant?". A transaction reported at or
// beyond the end of the variant's activation range is not applied AT ALL — no UTXO change, no `appliedId` bump, no
// transaction-history write — and only its version is recorded, which is what triggers the hand-over. Because the
// cursor did not move, the next variant re-fetches that same transaction and applies it exactly once.
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { HashMap } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultSyncCapability } from '../Sync.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { fixtureOwner, fixtureProgress, fixtureTransaction, fixtureUtxo, recordingHistory } from './syncFixtures.js';

/** The running variant owns versions 0..6; 7 and above belong to whatever replaces it. */
const activeRange = ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, ProtocolVersion.ProtocolVersion(7n));

const owner = fixtureOwner();

describe('unshielded sync capability at a variant boundary', () => {
  const setup = () => {
    const history = recordingHistory();
    const capability = makeDefaultSyncCapability(
      { indexerClientConnection: { indexerHttpUrl: 'http://unused' } },
      () => ({
        transactionHistoryService: history.service,
      }),
    );
    return { capability, history };
  };

  const emptyWallet = (protocolVersion: bigint = 0n, appliedId: bigint = 0n): CoreWallet =>
    CoreWallet.restore(
      UnshieldedState.empty(),
      owner,
      { appliedId, highestTransactionId: appliedId },
      ProtocolVersion.ProtocolVersion(protocolVersion),
      NetworkId.NetworkId.Undeployed,
    );

  it('applies a transaction reported below the boundary and records its version', () => {
    const { capability, history } = setup();
    const created = fixtureUtxo(owner, 100n, 0);

    const result = capability
      .applyUpdate(
        emptyWallet(),
        fixtureTransaction({ id: 1, protocolVersion: 3, createdUtxos: [created] }),
        activeRange,
      )
      .pipe(EitherOps.getOrThrowLeft);

    expect(HashMap.size(result.state.availableUtxos)).toBe(1);
    expect(result.progress.appliedId).toBe(1n);
    expect(result.protocolVersion).toBe(3n);
    expect(history.puts()).toHaveLength(1);
  });

  it('re-annotates on a version bump that stays inside the range', () => {
    const { capability, history } = setup();
    const created = fixtureUtxo(owner, 50n, 1);

    const result = capability
      .applyUpdate(
        emptyWallet(3n, 1n),
        fixtureTransaction({ id: 2, protocolVersion: 5, createdUtxos: [created] }),
        activeRange,
      )
      .pipe(EitherOps.getOrThrowLeft);

    expect(HashMap.size(result.state.availableUtxos)).toBe(1);
    expect(result.progress.appliedId).toBe(2n);
    expect(result.protocolVersion).toBe(5n);
    expect(history.puts()).toHaveLength(1);
  });

  it('does not apply a transaction reported AT the boundary — only its version is recorded', () => {
    const { capability, history } = setup();
    const alreadyHeld = fixtureUtxo(owner, 100n, 0);
    const before = CoreWallet.applyUpdate(emptyWallet(3n, 1n), {
      createdUtxos: [alreadyHeld],
      spentUtxos: [],
      status: 'SUCCESS',
    }).pipe(EitherOps.getOrThrowLeft);

    const boundaryTx = fixtureTransaction({
      id: 2,
      protocolVersion: 7,
      createdUtxos: [fixtureUtxo(owner, 999n, 5)],
    });

    const result = capability.applyUpdate(before, boundaryTx, activeRange).pipe(EitherOps.getOrThrowLeft);

    // No UTXO change: the wallet still holds exactly what it held, and nothing of the boundary transaction.
    expect(HashMap.size(result.state.availableUtxos)).toBe(1);
    expect([...HashMap.values(result.state.availableUtxos)].map((u) => u.utxo.value)).toEqual([100n]);
    // No cursor movement: this is what makes the next variant re-fetch the same transaction.
    expect(result.progress.appliedId).toBe(1n);
    // No transaction-history write.
    expect(history.puts()).toHaveLength(0);
    // The version IS recorded — it is the migration signal.
    expect(result.protocolVersion).toBe(7n);
  });

  it('does not apply a transaction reported BEYOND the boundary', () => {
    const { capability, history } = setup();

    const result = capability
      .applyUpdate(
        emptyWallet(3n, 1n),
        fixtureTransaction({ id: 2, protocolVersion: 9, createdUtxos: [fixtureUtxo(owner, 5n, 2)] }),
        activeRange,
      )
      .pipe(EitherOps.getOrThrowLeft);

    expect(HashMap.size(result.state.availableUtxos)).toBe(0);
    expect(result.progress.appliedId).toBe(1n);
    expect(history.puts()).toHaveLength(0);
    expect(result.protocolVersion).toBe(9n);
  });

  it('does not apply a SPEND reported at the boundary — the spent UTXO stays available', () => {
    const { capability, history } = setup();
    const held = fixtureUtxo(owner, 100n, 0);
    const before = CoreWallet.applyUpdate(emptyWallet(3n, 1n), {
      createdUtxos: [held],
      spentUtxos: [],
      status: 'SUCCESS',
    }).pipe(EitherOps.getOrThrowLeft);

    const result = capability
      .applyUpdate(before, fixtureTransaction({ id: 2, protocolVersion: 7, spentUtxos: [held] }), activeRange)
      .pipe(EitherOps.getOrThrowLeft);

    expect(HashMap.size(result.state.availableUtxos)).toBe(1);
    expect(result.progress.appliedId).toBe(1n);
    expect(history.puts()).toHaveLength(0);
  });

  it('does not apply a FAILED transaction reported at the boundary either', () => {
    const { capability, history } = setup();

    const result = capability
      .applyUpdate(
        emptyWallet(3n, 1n),
        fixtureTransaction({
          id: 2,
          protocolVersion: 7,
          createdUtxos: [fixtureUtxo(owner, 5n, 2)],
          status: 'FAILURE',
        }),
        activeRange,
      )
      .pipe(EitherOps.getOrThrowLeft);

    expect(result.progress.appliedId).toBe(1n);
    expect(history.puts()).toHaveLength(0);
    expect(result.protocolVersion).toBe(7n);
  });

  it('applies a failed transaction reported below the boundary and records its version', () => {
    const { capability } = setup();

    const result = capability
      .applyUpdate(
        emptyWallet(0n, 0n),
        fixtureTransaction({
          id: 1,
          protocolVersion: 4,
          createdUtxos: [fixtureUtxo(owner, 5n, 2)],
          status: 'FAILURE',
        }),
        activeRange,
      )
      .pipe(EitherOps.getOrThrowLeft);

    expect(result.progress.appliedId).toBe(1n);
    expect(result.protocolVersion).toBe(4n);
  });

  it('never lowers the recorded version', () => {
    const { capability } = setup();

    const result = capability
      .applyUpdate(
        emptyWallet(5n, 1n),
        fixtureTransaction({ id: 2, protocolVersion: 2, createdUtxos: [fixtureUtxo(owner, 7n, 3)] }),
        activeRange,
      )
      .pipe(EitherOps.getOrThrowLeft);

    // Applied — 2 is inside the range — but the recorded version does not go backwards.
    expect(result.progress.appliedId).toBe(2n);
    expect(HashMap.size(result.state.availableUtxos)).toBe(1);
    expect(result.protocolVersion).toBe(5n);
  });

  it('progress messages never touch the recorded version', () => {
    const { capability } = setup();

    // Even one reporting a chain past the boundary. Annotating here would be an ungated hand-over: the version would be
    // recorded without anything having checked that the 41 transactions below the frame's tip have been applied.
    const result = capability
      .applyUpdate(emptyWallet(3n, 1n), fixtureProgress(42, 9), activeRange)
      .pipe(EitherOps.getOrThrowLeft);

    expect(result.progress.highestTransactionId).toBe(42n);
    expect(result.progress.isConnected).toBe(true);
    expect(result.progress.appliedId).toBe(1n);
    expect(result.protocolVersion).toBe(3n);
  });

  it('a progress message on a wallet at the range floor still records nothing', () => {
    const { capability } = setup();

    const result = capability
      .applyUpdate(emptyWallet(0n, 0n), fixtureProgress(7, 9), activeRange)
      .pipe(EitherOps.getOrThrowLeft);

    expect(result.protocolVersion).toBe(0n);
  });
});
