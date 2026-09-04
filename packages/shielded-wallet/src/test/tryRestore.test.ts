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
 * Restoring a wallet from a snapshot that might not be readable.
 *
 * @remarks
 *   `restore` throws, which is the right shape for the case an application has just written the snapshot itself and a
 *   failure is a bug. It is the wrong shape for the case an application restores something a user supplied, or
 *   something written by a build of the SDK that is no longer the one running: a snapshot from a protocol version this
 *   build has no variant for is an ordinary thing to meet, not an exception. `tryRestore` answers those without
 *   throwing, and `restore` is left exactly as it was.
 */
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { UnsupportedSnapshotVersionError } from '../Restore.js';
import { type DefaultShieldedConfiguration } from '../ShieldedWalletAPI.js';
import { ShieldedWallet } from '../ShieldedWallet.js';
import { TransactionHistory } from '../v2/index.js';

const configuration: DefaultShieldedConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistory.ShieldedTransactionHistoryEntrySchema),
  forkVersion: ProtocolVersion.V9NativeForkVersion,
};

/** A snapshot declaring a protocol version far beyond anything this build registers a variant for. */
const fromTheFuture = JSON.stringify({
  publicKeys: { coinPublicKey: 'aa', encryptionPublicKey: 'bb' },
  state: 'deadbeef',
  protocolVersion: String(ProtocolVersion.MaxSupportedVersion),
  networkId: 'undeployed',
  coinHashes: {},
});

/** A snapshot no variant can read: routed to the head variant, which then cannot deserialize it. */
const unreadable = JSON.stringify({ protocolVersion: '1', state: 'not a state at all' });

const seed = Buffer.alloc(32, 7);

describe('a shielded wallet restored from a snapshot it can read', () => {
  it('comes back as a wallet, rather than as a reason it could not', async () => {
    const source = await ShieldedWallet(configuration).startWithSeed(seed);
    const written = await source.serializeState();
    await source.stop();

    const restored = ShieldedWallet(configuration).tryRestore(written);

    expect(Either.isRight(restored)).toBe(true);
    await Either.getOrThrow(restored).stop();
  });
});

describe('a shielded wallet restored from a snapshot it cannot read', () => {
  it('reports a protocol version no registered variant owns, instead of throwing', () => {
    const failure = ShieldedWallet(configuration).tryRestore(fromTheFuture).pipe(Either.flip, Either.getOrThrow);

    expect(failure).toBeInstanceOf(UnsupportedSnapshotVersionError);
  });

  it('reports bytes that are not a wallet state, instead of throwing', () => {
    const restored = ShieldedWallet(configuration).tryRestore(unreadable);

    expect(Either.isLeft(restored)).toBe(true);
  });

  it('refuses exactly the snapshots restore refuses, and keeps the reason restore discards', () => {
    // The two cannot disagree about which snapshots are readable, because `restore` is `tryRestore` with the reason
    // thrown away. And thrown away is literally what happens: the exception carries none of it, which is the whole
    // reason for the additive shape.
    for (const snapshot of [fromTheFuture, unreadable]) {
      expect(() => ShieldedWallet(configuration).restore(snapshot)).toThrow();
      expect(Either.isLeft(ShieldedWallet(configuration).tryRestore(snapshot))).toBe(true);
    }

    const thrown = (() => {
      try {
        return ShieldedWallet(configuration).restore(fromTheFuture);
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).not.toBeInstanceOf(UnsupportedSnapshotVersionError);
    expect(ShieldedWallet(configuration).tryRestore(fromTheFuture).pipe(Either.flip, Either.getOrThrow)).toBeInstanceOf(
      UnsupportedSnapshotVersionError,
    );
  });
});
