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
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  SnapshotFormat,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { type DefaultDustConfiguration } from '../DustWalletAPI.js';
import { CustomForkingDustWallet, DustWallet, dustVariantConfigurations } from '../DustWallet.js';
import { UnsupportedSnapshotVersionError } from '../Restore.js';
import { V1Builder } from '../v1/index.js';
import { CoreWallet, Serialization, SyncService, TransactionHistory, V2Builder } from '../v2/index.js';
import { ProgressUpdate } from '../v2/SyncSchema.js';

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
    const restored = DustWallet(configuration).tryRestore(unreadable);

    expect(Either.isLeft(restored)).toBe(true);
    // With the tagged refusal every snapshot surface raises, naming the surface, the version and the reason.
    const refusal = restored.pipe(Either.flip, Either.getOrThrow);
    expect(refusal).toBeInstanceOf(SnapshotFormat.SnapshotRestoreError);
    expect(refusal).toMatchObject({ surface: 'dust', reason: 'invalid-shape', detectedVersion: 'v1' });
  });

  it('throws exactly the reason tryRestore reports, for exactly the snapshots tryRestore refuses', () => {
    // `restore` is `tryRestore` with the Left thrown rather than discarded, so an app that only calls `restore` still
    // learns the surface and the version from the exception, as the `@throws` on `restore` promises.
    for (const snapshot of [fromTheFuture, unreadable]) {
      expect(() => DustWallet(configuration).restore(snapshot)).toThrow();
      expect(Either.isLeft(DustWallet(configuration).tryRestore(snapshot))).toBe(true);
    }

    expect(() => DustWallet(configuration).restore(fromTheFuture)).toThrow(UnsupportedSnapshotVersionError);
    expect(DustWallet(configuration).tryRestore(fromTheFuture).pipe(Either.flip, Either.getOrThrow)).toBeInstanceOf(
      UnsupportedSnapshotVersionError,
    );
  });
});

/**
 * Restoring a Dust wallet from a snapshot whose position was recorded by a different synchronization than the one the
 * wallet resumes with.
 *
 * @remarks
 *   The two synchronizations save their position in the same `offset`, and mean different things by it. Event replay
 *   saves the id of the last dust ledger event it applied, and resumes the subscription from it. A projections pass
 *   saves the height of the block it last synced to, which is not an event id at all. A wallet that replays events,
 *   handed a projections position, would subscribe from an id that names an unrelated event: past the last one, it
 *   would wait forever for events that never arrive; below it, it would skip the dust in between. Neither surfaces as
 *   an error once the wallet runs, because a failed pass is retried rather than reported — so the refusal has to come
 *   at restore, where the application decides what to do with a snapshot it cannot use.
 *
 *   The other direction is safe and stays accepted: a projections pass resumes from the trees in the ledger state itself,
 *   and handed an event position it asks for every dtime update rather than misreading the event id as a height.
 */
describe('a Dust wallet restored from a snapshot whose position another synchronization recorded', () => {
  const forkVersion = configuration.forks.v9;
  const fromTheFork = ProtocolVersion.makeRange(forkVersion, ProtocolVersion.MaxSupportedVersion);
  const secretKey = ledger.DustSecretKey.fromSeed(seed);
  const dustParameters = ledger.LedgerParameters.initialParameters().dust;
  const serialization = Serialization.makeDefaultV2SerializationCapability();

  /** A V2 wallet past the fork, as a start there leaves it, before anything has been synchronized. */
  const pastTheFork = (): CoreWallet =>
    CoreWallet.withProtocolVersion(
      CoreWallet.initEmpty(dustParameters, secretKey, configuration.networkId),
      forkVersion,
    );

  /** Saved after a projections pass reported its progress, so its position is a projections one. */
  const projectionsSnapshot = (): string => {
    const [reported] = SyncService.makeEventLessSyncCapability().applyUpdate(
      pastTheFork(),
      ProgressUpdate({ appliedIndex: 4_242, highestRelevantIndex: 9_000 }),
      fromTheFork,
    );
    return serialization.serialize(reported);
  };

  /** Saved by a wallet positioned at dust ledger event 3326, the way event replay keeps its position. */
  const eventsSnapshot = (): string =>
    serialization.serialize(CoreWallet.updateProgress(pastTheFork(), { appliedIndex: 3_326n }));

  /** The shipped two-variant wallet with its V2 variant synchronizing by projections, as `dust-fast-sync.ts` builds it. */
  const ProjectionsDustWallet = () => {
    const { v1, v2, migration } = dustVariantConfigurations(configuration);
    return CustomForkingDustWallet(
      configuration,
      { builder: new V1Builder().withDefaults(), configuration: v1 },
      {
        builder: new V2Builder()
          .withDefaults()
          .withSync(SyncService.makeEventLessSyncService, SyncService.makeEventLessSyncCapability)
          .withStartAuxDefaults()
          .withMigration(migration),
        configuration: v2,
      },
    );
  };

  /** Stops a wallet the restore produced, so a test that expected a refusal leaves nothing running when it fails. */
  const stopIfRestored = (restored: Either.Either<{ stop(): Promise<void> }, unknown>): Promise<void> =>
    Either.match(restored, { onLeft: () => Promise.resolve(), onRight: (wallet) => wallet.stop() });

  it('is refused by a wallet that replays dust events, which would read the block height as an event id', async () => {
    const restored = DustWallet(configuration).tryRestore(projectionsSnapshot());
    await stopIfRestored(restored);

    expect(Option.getOrUndefined(Either.getLeft(restored))).toMatchObject({
      _tag: 'Wallet.SnapshotSyncMismatch',
      syncKind: 'projections',
      resumesFrom: 'events',
    });
  });

  it('is accepted by a wallet that synchronizes by projections, the one that recorded it', async () => {
    const restored = ProjectionsDustWallet().tryRestore(projectionsSnapshot());
    await stopIfRestored(restored);

    expect(Either.isRight(restored)).toBe(true);
  });

  it('accepts a dust event position into a wallet that synchronizes by projections, which resumes from its own trees', async () => {
    const restored = ProjectionsDustWallet().tryRestore(eventsSnapshot());
    await stopIfRestored(restored);

    expect(Either.isRight(restored)).toBe(true);
  });
});
