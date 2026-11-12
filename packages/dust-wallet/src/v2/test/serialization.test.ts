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
  DustLocalState,
  DustSecretKey,
  LedgerParameters,
  type QualifiedDustOutput,
  dustNullifier,
  maxField,
} from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Either, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet, PublicKey } from '../CoreWallet.js';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';
import { type PendingDust } from '../types/Dust.js';

const networkId = NetworkId.NetworkId.Undeployed;
const dustParameters = LedgerParameters.initialParameters().dust;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';

describe('V2 dust wallet serialization', () => {
  it('serialize ◦ deserialize == id for empty wallet', () => {
    const capability = makeDefaultV2SerializationCapability();
    const dustSecretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
    const wallet = CoreWallet.initEmpty(dustParameters, dustSecretKey, networkId);

    const firstIteration = capability.serialize(wallet);
    const restored = pipe(capability.deserialize(null, firstIteration), EitherOps.getOrThrowLeft);
    const secondIteration = capability.serialize(restored);

    expect(firstIteration).toEqual(secondIteration);
  });

  it('returns Left with SnapshotRestoreError for input that does not match the snapshot schema', () => {
    const capability = makeDefaultV2SerializationCapability();
    const result = capability.deserialize(null, '{"not":"a snapshot"}');

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapshotFormat.SnapshotRestoreError);
      expect(result.left).toMatchObject({ surface: 'dust', reason: 'invalid-shape', detectedVersion: 'v1' });
    }
  });
});

describe('V2 dust snapshot format version', () => {
  const capability = makeDefaultV2SerializationCapability();
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

describe('V2 dust snapshot pending Dust', () => {
  const capability = makeDefaultV2SerializationCapability();
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
  const backingNight = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

  const pendingCoin = (): PendingDust => {
    const qdo: QualifiedDustOutput = {
      initialValue: 2_500_000_000_000n,
      owner: secretKey.publicKey,
      nonce: 0x1f2e3d4c5b6a79881f2e3d4c5b6a7988n,
      seq: 3,
      ctime: new Date('2026-09-14T10:20:30.000Z'),
      backingNight,
      mtIndex: 42n,
    };
    return {
      coin: qdo,
      nullifier: dustNullifier(qdo, secretKey),
      declaredTime: new Date('2026-09-14T10:22:00.000Z'),
    };
  };

  /** A wallet whose pending transaction has spent one Dust coin that no sync has yet settled. */
  const walletWithPendingDust = (): CoreWallet =>
    CoreWallet.restore(
      new DustLocalState(dustParameters),
      PublicKey.fromSecretKey(secretKey),
      [pendingCoin()],
      { appliedIndex: 0n, highestRelevantWalletIndex: 0n, highestIndex: 0n, highestRelevantIndex: 0n },
      ProtocolVersion.MinSupportedVersion,
      networkId,
      'events',
    );

  /** A snapshot as the first format wrote it: stamped 'v1', with no pending Dust recorded. */
  const asFirstFormat = (serialized: string): string => {
    const { pendingDust: _pendingDust, ...rest } = JSON.parse(serialized) as Record<string, unknown>;
    return JSON.stringify({ ...rest, version: 'v1' });
  };

  it('should keep a pending Dust coin, nullifier included, through serialize then deserialize, so a restored wallet can still release it', () => {
    const wallet = walletWithPendingDust();

    const restored = pipe(capability.deserialize(null, capability.serialize(wallet)), EitherOps.getOrThrowLeft);

    expect(restored.pendingDust).toEqual(wallet.pendingDust);
  });

  it('should stamp every snapshot it writes as format v2, because the snapshot now records pending Dust', () => {
    const written: unknown = JSON.parse(capability.serialize(walletWithPendingDust()));

    expect(written).toMatchObject({ version: 'v2' });
  });

  it('should read a v1 snapshot, which recorded no pending Dust, as holding no pending Dust', () => {
    const restored = pipe(
      capability.deserialize(null, asFirstFormat(capability.serialize(walletWithPendingDust()))),
      EitherOps.getOrThrowLeft,
    );

    expect(restored.pendingDust).toEqual([]);
  });
});

describe('V2 dust snapshot field bounds', () => {
  const capability = makeDefaultV2SerializationCapability();
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
  const coin: QualifiedDustOutput = {
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
  const u128Max = 2n ** 128n - 1n;
  const u32Max = 2 ** 32 - 1;

  type Json = Record<string, unknown>;

  /** The JSON of a snapshot the wallet can sync and value: one pending Dust coin, every field in range. */
  const validSnapshot = (): Json =>
    JSON.parse(
      capability.serialize(
        CoreWallet.restore(
          new DustLocalState(dustParameters),
          PublicKey.fromSecretKey(secretKey),
          [{ coin, nullifier: dustNullifier(coin, secretKey), declaredTime }],
          { appliedIndex: 0n, highestRelevantWalletIndex: 0n, highestIndex: 0n, highestRelevantIndex: 0n },
          ProtocolVersion.MinSupportedVersion,
          networkId,
          'events',
        ),
      ),
    ) as Json;

  const withEntry = (snapshot: Json, fields: Json): Json => {
    const [entry] = snapshot['pendingDust'] as Json[];
    return { ...snapshot, pendingDust: [{ ...entry, ...fields }] };
  };

  const withCoin = (snapshot: Json, fields: Json): Json => {
    const [entry] = snapshot['pendingDust'] as Json[];
    return withEntry(snapshot, { coin: { ...(entry['coin'] as Json), ...fields } });
  };

  const outOfRange: ReadonlyArray<readonly [string, (snapshot: Json) => Json]> = [
    ['a negative nullifier', (s) => withEntry(s, { nullifier: '-1' })],
    ['a nullifier outside the field', (s) => withEntry(s, { nullifier: String(maxField() + 1n) })],
    ['a negative initialValue', (s) => withCoin(s, { initialValue: '-1' })],
    ['an initialValue above u128', (s) => withCoin(s, { initialValue: String(u128Max + 1n) })],
    ['a negative owner', (s) => withCoin(s, { owner: '-1' })],
    ['an owner outside the field', (s) => withCoin(s, { owner: String(maxField() + 1n) })],
    ['a negative nonce', (s) => withCoin(s, { nonce: '-1' })],
    ['a nonce outside the field', (s) => withCoin(s, { nonce: String(maxField() + 1n) })],
    ['a fractional seq', (s) => withCoin(s, { seq: -1.5 })],
    ['a negative seq', (s) => withCoin(s, { seq: -1 })],
    ['a seq above u32', (s) => withCoin(s, { seq: u32Max + 1 })],
    ['a backingNight of odd length', (s) => withCoin(s, { backingNight: 'abc' })],
    ['a backingNight that is not hex', (s) => withCoin(s, { backingNight: 'zz'.repeat(32) })],
    ['a backingNight shorter than 32 bytes', (s) => withCoin(s, { backingNight: 'ab' })],
    ['a backingNight longer than 32 bytes', (s) => withCoin(s, { backingNight: 'ab'.repeat(33) })],
    ['a negative mtIndex', (s) => withCoin(s, { mtIndex: '-1' })],
    ['an mtIndex above u64', (s) => withCoin(s, { mtIndex: String(u64Max + 1n) })],
    ['a negative public key', (s) => ({ ...s, publicKey: { publicKey: '-1' } })],
    ['a public key outside the field', (s) => ({ ...s, publicKey: { publicKey: String(maxField() + 1n) } })],
    ['a negative protocolVersion', (s) => ({ ...s, protocolVersion: '-1' })],
    ['a negative offset', (s) => ({ ...s, offset: '-1' })],
    ['an offset above u64', (s) => ({ ...s, offset: String(u64Max + 1n) })],
  ];

  it.each(outOfRange)(
    'should refuse a snapshot holding %s, because a wallet restored from it could neither sync nor value its Dust',
    (_case, corrupt) => {
      const restored = capability.deserialize(null, JSON.stringify(corrupt(validSnapshot())));

      expect(Either.isLeft(restored)).toBe(true);
      if (Either.isLeft(restored)) {
        expect(restored.left).toBeInstanceOf(SnapshotFormat.SnapshotRestoreError);
        expect(restored.left).toMatchObject({ surface: 'dust', reason: 'invalid-shape', detectedVersion: 'v2' });
      }
    },
  );

  it('should restore a snapshot whose every bounded field sits at the largest value the ledger accepts', () => {
    const atBounds = {
      ...withCoin(withEntry(validSnapshot(), { nullifier: String(maxField()) }), {
        initialValue: String(u128Max),
        owner: String(maxField()),
        nonce: String(maxField()),
        seq: u32Max,
        backingNight: 'AB'.repeat(32),
        mtIndex: String(u64Max),
      }),
      publicKey: { publicKey: String(maxField()) },
      protocolVersion: String(ProtocolVersion.MaxSupportedVersion),
      offset: String(u64Max),
    };

    const restored = pipe(capability.deserialize(null, JSON.stringify(atBounds)), EitherOps.getOrThrowLeft);

    expect(restored.pendingDust).toEqual([
      {
        coin: {
          ...coin,
          initialValue: u128Max,
          owner: maxField(),
          nonce: maxField(),
          seq: u32Max,
          backingNight: 'AB'.repeat(32),
          mtIndex: u64Max,
        },
        nullifier: maxField(),
        declaredTime,
      },
    ]);
    expect(restored.publicKey).toEqual({ publicKey: maxField() });
    expect(restored.protocolVersion).toBe(ProtocolVersion.MaxSupportedVersion);
    expect(restored.progress.appliedIndex).toBe(u64Max);
  });
});
