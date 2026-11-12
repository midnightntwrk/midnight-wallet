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
import { DustLocalState, DustSecretKey, LedgerParameters, dustNullifier, maxField } from '@midnightntwrk/ledger-v8';
import { NetworkId, ProtocolVersion, SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Either, Schema, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet, PublicKey } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { type Dust, type PendingDust } from '../types/Dust.js';

const networkId = NetworkId.NetworkId.Undeployed;
const dustParameters = LedgerParameters.initialParameters().dust;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';

describe('V1 dust wallet serialization', () => {
  it('serialize ◦ deserialize == id for empty wallet', () => {
    const capability = makeDefaultV1SerializationCapability();
    const dustSecretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
    const wallet = CoreWallet.initEmpty(dustParameters, dustSecretKey, networkId);

    const firstIteration = capability.serialize(wallet);
    const restored = pipe(capability.deserialize(null, firstIteration), EitherOps.getOrThrowLeft);
    const secondIteration = capability.serialize(restored);

    expect(firstIteration).toEqual(secondIteration);
  });

  it('returns Left with SnapshotRestoreError for input that does not match the snapshot schema', () => {
    const capability = makeDefaultV1SerializationCapability();
    const result = capability.deserialize(null, '{"not":"a snapshot"}');

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapshotFormat.SnapshotRestoreError);
      expect(result.left).toMatchObject({ surface: 'dust', reason: 'invalid-shape', detectedVersion: 'v1' });
    }
  });
});

describe('V1 dust snapshot format version', () => {
  const capability = makeDefaultV1SerializationCapability();
  const emptyWallet = () =>
    CoreWallet.initEmpty(dustParameters, DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex')), networkId);

  /** A snapshot as written before the format version existed: today's fields, with no `version` among them. */
  const withoutVersion = (serialized: string): string => {
    const { version: _version, ...rest } = JSON.parse(serialized) as Record<string, unknown>;
    return JSON.stringify(rest);
  };

  it('should stamp the current format version into every snapshot it writes', () => {
    const written: unknown = JSON.parse(capability.serialize(emptyWallet()));

    expect(written).toMatchObject({ version: 'v2' });
  });

  it('should read a snapshot that carries no version as the first format', () => {
    const restored = capability.deserialize(null, withoutVersion(capability.serialize(emptyWallet())));

    expect(Either.isRight(restored)).toBe(true);
  });

  it('should refuse a snapshot whose version this build does not know', () => {
    const fromANewerSdk = JSON.stringify({
      ...(JSON.parse(capability.serialize(emptyWallet())) as Record<string, unknown>),
      version: 'v3',
    });

    const restored = capability.deserialize(null, fromANewerSdk);

    expect(Either.isLeft(restored)).toBe(true);
  });

  it('should name the surface and the version it found when it refuses a snapshot', () => {
    const fromANewerSdk = JSON.stringify({
      ...(JSON.parse(capability.serialize(emptyWallet())) as Record<string, unknown>),
      version: 'v3',
    });

    const restored = capability.deserialize(null, fromANewerSdk);
    const failure = Either.isLeft(restored) ? restored.left.message : 'the snapshot was restored';

    expect(failure).toContain(
      'Refusing a dust snapshot written in format version "v3": this build reads v2 and does not downgrade.',
    );
  });
});

describe('V1 dust snapshot pending Dust', () => {
  const capability = makeDefaultV1SerializationCapability();
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));

  const pendingCoin = ((): PendingDust => {
    const coin: Dust = {
      initialValue: 1_000_000n,
      owner: secretKey.publicKey,
      nonce: 7n,
      seq: 0,
      ctime: new Date('2026-01-01T00:00:00.000Z'),
      backingNight: 'ab'.repeat(32),
      mtIndex: 3n,
    };
    return {
      coin,
      nullifier: dustNullifier(coin, secretKey),
      declaredTime: new Date('2026-01-01T00:02:30.000Z'),
    };
  })();

  // A wallet whose pending transaction spent `pendingCoin`: the coin is booked as pending, not yet settled.
  const walletWithPendingDust = (): CoreWallet =>
    CoreWallet.restore(
      new DustLocalState(dustParameters),
      PublicKey.fromSecretKey(secretKey),
      [pendingCoin],
      { appliedIndex: 0n, highestRelevantWalletIndex: 0n, highestIndex: 0n, highestRelevantIndex: 0n },
      0n,
      networkId,
    );

  it('should keep a pending Dust coin through serialize then deserialize, so a restored wallet can still release it', () => {
    const restored = pipe(
      capability.deserialize(null, capability.serialize(walletWithPendingDust())),
      EitherOps.getOrThrowLeft,
    );

    expect(restored.pendingDust).toEqual([pendingCoin]);
  });

  it('should stamp format version v2 into every snapshot it writes, because the snapshot now carries pending Dust', () => {
    const written = JSON.parse(capability.serialize(walletWithPendingDust())) as Record<string, unknown>;

    expect(written['version']).toBe('v2');
  });

  it('should read a v1 snapshot, which recorded no pending Dust, with no pending Dust', () => {
    const { pendingDust: _pendingDust, ...rest } = JSON.parse(capability.serialize(walletWithPendingDust())) as Record<
      string,
      unknown
    >;
    const writtenAsV1 = JSON.stringify({ ...rest, version: 'v1' });

    const restored = pipe(capability.deserialize(null, writtenAsV1), EitherOps.getOrThrowLeft);

    expect(restored.pendingDust).toEqual([]);
  });
});

describe('V1 dust snapshot field bounds', () => {
  const capability = makeDefaultV1SerializationCapability();
  const keysCapability = makeDefaultKeysCapability();
  const coinsAndBalances = makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability }));
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
  const coin: Dust = {
    initialValue: 1_000_000n,
    owner: secretKey.publicKey,
    nonce: 7n,
    seq: 0,
    ctime: new Date('2026-01-01T00:00:00.000Z'),
    backingNight: 'ab'.repeat(32),
    mtIndex: 3n,
  };
  const declaredTime = new Date('2026-01-01T00:02:30.000Z');
  const u64Max = 2n ** 64n - 1n;
  const fieldMax = maxField();
  const u128Max = 2n ** 128n - 1n;
  const u32Max = 2 ** 32 - 1;
  /** The largest value the indexer's GraphQL `Int` takes, as the dust event id or the dtime cutoff height. */
  const graphQlIntMax = 2n ** 31n - 1n;

  const JsonObject = Schema.Record({ key: Schema.String, value: Schema.Unknown });
  type Json = typeof JsonObject.Type;
  const asJsonObject = Schema.decodeUnknownSync(JsonObject);
  const asJsonObjects = Schema.decodeUnknownSync(Schema.Array(JsonObject));

  /** The JSON of a snapshot the wallet can sync and value: one pending Dust coin, every field in range. */
  const validSnapshot = (): Json =>
    asJsonObject(
      JSON.parse(
        capability.serialize(
          CoreWallet.restore(
            new DustLocalState(dustParameters),
            PublicKey.fromSecretKey(secretKey),
            [{ coin, nullifier: dustNullifier(coin, secretKey), declaredTime }],
            { appliedIndex: 0n, highestRelevantWalletIndex: 0n, highestIndex: 0n, highestRelevantIndex: 0n },
            ProtocolVersion.MinSupportedVersion,
            networkId,
          ),
        ),
      ),
    );

  const withEntry = (snapshot: Json, fields: Json): Json => {
    const [entry] = asJsonObjects(snapshot['pendingDust']);
    return { ...snapshot, pendingDust: [{ ...entry, ...fields }] };
  };

  const withCoin = (snapshot: Json, fields: Json): Json => {
    const [entry] = asJsonObjects(snapshot['pendingDust']);
    return withEntry(snapshot, { coin: { ...asJsonObject(entry?.['coin']), ...fields } });
  };

  const expectRefused = (snapshot: Json): void => {
    const restored = capability.deserialize(null, JSON.stringify(snapshot));

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(SnapshotFormat.SnapshotRestoreError);
      expect(restored.left).toMatchObject({ surface: 'dust', reason: 'invalid-shape', detectedVersion: 'v2' });
    }
  };

  const pendingEntryOutOfRange: ReadonlyArray<readonly [string, (snapshot: Json) => Json]> = [
    ['a negative nullifier', (s) => withEntry(s, { nullifier: '-1' })],
    ['a nullifier outside the field', (s) => withEntry(s, { nullifier: String(fieldMax + 1n) })],
    ['a negative initialValue', (s) => withCoin(s, { initialValue: '-1' })],
    ['an initialValue above u128', (s) => withCoin(s, { initialValue: String(u128Max + 1n) })],
    ['a negative owner', (s) => withCoin(s, { owner: '-1' })],
    ['an owner outside the field', (s) => withCoin(s, { owner: String(fieldMax + 1n) })],
    ['a negative nonce', (s) => withCoin(s, { nonce: '-1' })],
    ['a nonce outside the field', (s) => withCoin(s, { nonce: String(fieldMax + 1n) })],
    ['a fractional seq', (s) => withCoin(s, { seq: 1.5 })],
    ['a negative seq', (s) => withCoin(s, { seq: -1 })],
    ['a seq above u32', (s) => withCoin(s, { seq: u32Max + 1 })],
    ['a backingNight of odd length', (s) => withCoin(s, { backingNight: 'abc' })],
    ['a backingNight that is not hex', (s) => withCoin(s, { backingNight: 'zz'.repeat(32) })],
    ['a backingNight shorter than 32 bytes', (s) => withCoin(s, { backingNight: 'ab' })],
    ['a backingNight longer than 32 bytes', (s) => withCoin(s, { backingNight: 'ab'.repeat(33) })],
    ['a negative mtIndex', (s) => withCoin(s, { mtIndex: '-1' })],
    ['an mtIndex above u64', (s) => withCoin(s, { mtIndex: String(u64Max + 1n) })],
  ];

  const topLevelOutOfRange: ReadonlyArray<readonly [string, (snapshot: Json) => Json]> = [
    ['a negative public key', (s) => ({ ...s, publicKey: { publicKey: '-1' } })],
    ['a public key outside the field', (s) => ({ ...s, publicKey: { publicKey: String(fieldMax + 1n) } })],
    ['a negative protocolVersion', (s) => ({ ...s, protocolVersion: '-1' })],
    [
      'a protocolVersion at the exclusive end of every variant range',
      (s) => ({ ...s, protocolVersion: String(ProtocolVersion.MaxSupportedVersion) }),
    ],
    [
      'a protocolVersion past the end of every variant range',
      (s) => ({ ...s, protocolVersion: String(ProtocolVersion.MaxSupportedVersion + 1n) }),
    ],
    ['a negative offset', (s) => ({ ...s, offset: '-1' })],
    ['an offset above the largest the indexer takes', (s) => ({ ...s, offset: String(graphQlIntMax + 1n) })],
    ['an offset above u64', (s) => ({ ...s, offset: String(u64Max + 1n) })],
  ];

  it.each(pendingEntryOutOfRange)(
    'should refuse a snapshot holding %s, because the ledger cannot settle or value that pending entry',
    (_case, corrupt) => expectRefused(corrupt(validSnapshot())),
  );

  it.each(topLevelOutOfRange)(
    'should refuse a snapshot holding %s, because the wallet could not run or sync from it',
    (_case, corrupt) => expectRefused(corrupt(validSnapshot())),
  );

  it('should restore a snapshot whose every bounded field sits at the largest value the wallet accepts, because the ledger reads each of them without throwing', () => {
    const atBounds = {
      ...withCoin(withEntry(validSnapshot(), { nullifier: String(fieldMax) }), {
        initialValue: String(u128Max),
        owner: String(fieldMax),
        nonce: String(fieldMax),
        seq: u32Max,
        backingNight: 'AB'.repeat(32),
        mtIndex: String(u64Max),
      }),
      publicKey: { publicKey: String(fieldMax) },
      protocolVersion: String(ProtocolVersion.MaxSupportedVersion - 1n),
      offset: String(graphQlIntMax),
    };

    const restored = pipe(capability.deserialize(null, JSON.stringify(atBounds)), EitherOps.getOrThrowLeft);

    expect(restored.pendingDust).toEqual([
      {
        coin: {
          ...coin,
          initialValue: u128Max,
          owner: fieldMax,
          nonce: fieldMax,
          seq: u32Max,
          backingNight: 'AB'.repeat(32),
          mtIndex: u64Max,
        },
        nullifier: fieldMax,
        declaredTime,
      },
    ]);
    expect(restored.publicKey).toEqual({ publicKey: fieldMax });
    expect(restored.protocolVersion).toBe(ProtocolVersion.MaxSupportedVersion - 1n);
    expect(restored.progress.appliedIndex).toBe(graphQlIntMax);

    // Settling and valuing hand every bounded value to the ledger. The restored state holds no generation backing the
    // coin, so each read finds none: this proves the ledger reads the values, not that it values them.
    const syncTime = new Date('2026-01-01T00:05:00.000Z');
    const settled = CoreWallet.settlePendingDust(
      restored.pendingDust,
      restored.state,
      restored.state.processTtls(syncTime),
      [],
      syncTime,
    );
    expect(settled).toEqual([]);
    expect(coinsAndBalances.getPendingCoins(restored, syncTime)).toEqual([]);
    expect(coinsAndBalances.getTotalCoins(restored, syncTime)).toEqual([]);
  });

  it('should restore a snapshot whose every bounded field sits at its lowest value, because zero is in range for each', () => {
    const atLowest = {
      ...withCoin(withEntry(validSnapshot(), { nullifier: '0' }), {
        initialValue: '0',
        owner: '0',
        nonce: '0',
        seq: 0,
        mtIndex: '0',
      }),
      publicKey: { publicKey: '0' },
      offset: '0',
    };

    const restored = pipe(capability.deserialize(null, JSON.stringify(atLowest)), EitherOps.getOrThrowLeft);

    expect(restored.pendingDust).toEqual([
      {
        coin: { ...coin, initialValue: 0n, owner: 0n, nonce: 0n, seq: 0, mtIndex: 0n },
        nullifier: 0n,
        declaredTime,
      },
    ]);
    expect(restored.publicKey).toEqual({ publicKey: 0n });
    expect(restored.protocolVersion).toBe(ProtocolVersion.MinSupportedVersion);
    expect(restored.progress.appliedIndex).toBe(0n);
  });

  it('should restore a snapshot on a custom network, because a network id is any string', () => {
    const onCustomNetwork = { ...validSnapshot(), networkId: 'my-custom-network' };

    const restored = pipe(capability.deserialize(null, JSON.stringify(onCustomNetwork)), EitherOps.getOrThrowLeft);

    expect(restored.networkId).toBe('my-custom-network');
  });
});
