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
 * Restoring a Dust wallet from a snapshot that might not be readable. See the shielded wallet's suite of the same name
 * for why the additive shape exists; the claims are the wallet-layer ones, and they hold identically here.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { type DefaultDustConfiguration } from '../DustWalletAPI.js';
import { DustWallet } from '../DustWallet.js';
import { UnsupportedSnapshotVersionError } from '../Restore.js';
import { TransactionHistory } from '../v2/index.js';

const configuration: DefaultDustConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistory.DustTransactionHistoryEntrySchema),
  costParameters: { feeBlocksMargin: 0 },
  forks: { v9: ProtocolVersion.ProtocolVersion(2_000_000n) },
};

/** A snapshot declaring a protocol version far beyond anything this build registers a variant for. */
const fromTheFuture = JSON.stringify({
  state: 'deadbeef',
  protocolVersion: String(ProtocolVersion.MaxSupportedVersion),
  networkId: 'undeployed',
});

/** A snapshot no variant can read: routed to the head variant, which then cannot deserialize it. */
const unreadable = JSON.stringify({ protocolVersion: '1', state: 'not a state at all' });

const seed = Buffer.alloc(32, 7);

describe('a Dust wallet restored from a snapshot it can read', () => {
  it('comes back as a wallet, rather than as a reason it could not', async () => {
    const source = await DustWallet(configuration).startWithSeed(
      seed,
      ledger.LedgerParameters.initialParameters().dust,
    );
    const written = await source.serializeState();
    await source.stop();

    const restored = DustWallet(configuration).tryRestore(written);

    expect(Either.isRight(restored)).toBe(true);
    await Either.getOrThrow(restored).stop();
  });
});

describe('a Dust wallet restored from a snapshot it cannot read', () => {
  it('reports a protocol version no registered variant owns, instead of throwing', () => {
    const failure = DustWallet(configuration).tryRestore(fromTheFuture).pipe(Either.flip, Either.getOrThrow);

    expect(failure).toBeInstanceOf(UnsupportedSnapshotVersionError);
  });

  it('reports bytes that are not a wallet state, instead of throwing', () => {
    expect(Either.isLeft(DustWallet(configuration).tryRestore(unreadable))).toBe(true);
  });

  it('refuses exactly the snapshots restore refuses, and keeps the reason restore discards', () => {
    for (const snapshot of [fromTheFuture, unreadable]) {
      expect(() => DustWallet(configuration).restore(snapshot)).toThrow();
      expect(Either.isLeft(DustWallet(configuration).tryRestore(snapshot))).toBe(true);
    }

    expect(DustWallet(configuration).tryRestore(fromTheFuture).pipe(Either.flip, Either.getOrThrow)).toBeInstanceOf(
      UnsupportedSnapshotVersionError,
    );
  });
});
