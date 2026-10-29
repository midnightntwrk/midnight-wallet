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
import { DustLocalState, DustSecretKey, LedgerParameters, dustNullifier } from '@midnight-ntwrk/ledger-v8';
import { NetworkId, SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Either, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet, PublicKey } from '../CoreWallet.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { type Dust, type DustWithNullifier } from '../types/Dust.js';

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

    expect(written).toMatchObject({ version: 'v1' });
  });

  it('should read a snapshot that carries no version as the first format', () => {
    const restored = capability.deserialize(null, withoutVersion(capability.serialize(emptyWallet())));

    expect(Either.isRight(restored)).toBe(true);
  });

  it('should refuse a snapshot whose version this build does not know', () => {
    const fromANewerSdk = JSON.stringify({
      ...(JSON.parse(capability.serialize(emptyWallet())) as Record<string, unknown>),
      version: 'v2',
    });

    const restored = capability.deserialize(null, fromANewerSdk);

    expect(Either.isLeft(restored)).toBe(true);
  });

  it('should name the surface and the version it found when it refuses a snapshot', () => {
    const fromANewerSdk = JSON.stringify({
      ...(JSON.parse(capability.serialize(emptyWallet())) as Record<string, unknown>),
      version: 'v2',
    });

    const restored = capability.deserialize(null, fromANewerSdk);
    const failure = Either.isLeft(restored) ? restored.left.message : 'the snapshot was restored';

    expect(failure).toContain(
      'Refusing a dust snapshot written in format version "v2": this build reads v1 and does not downgrade.',
    );
  });
});

describe('V1 dust snapshot pending Dust', () => {
  const capability = makeDefaultV1SerializationCapability();
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));

  const pendingCoin = ((): DustWithNullifier => {
    const coin: Dust = {
      initialValue: 1_000_000n,
      owner: secretKey.publicKey,
      nonce: 7n,
      seq: 0,
      ctime: new Date('2026-01-01T00:00:00.000Z'),
      backingNight: 'ab'.repeat(32),
      mtIndex: 3n,
    };
    return { ...coin, nullifier: dustNullifier(coin, secretKey) };
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
