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
import { describe, expect, it } from 'vitest';
import { Either, HashMap, Option, pipe } from 'effect';
import { NetworkId, ProtocolVersion, SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { makeDefaultV2SerializationCapability, LEGACY_BOOKING_LIFETIME_MS } from '../Serialization.js';
import { CoreWallet } from '../CoreWallet.js';
import { type PendingUtxo, UnshieldedState, type UtxoWithMeta } from '../UnshieldedState.js';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { OtherWalletError, SchemeMismatchError } from '../WalletError.js';
import { generateMockUtxoWithMeta, utxoHash } from './testUtils.js';

const networkId = NetworkId.NetworkId.Undeployed;

const TTL = new Date('2026-01-01T01:00:00.000Z');

// Real, scheme-consistent public keys (key encoding matches its tag, and the
// address derives from the key) so deserialization's scheme-consistency guards
// accept them. Both come from the same scalar to keep the fixtures compact.
const secret = Buffer.alloc(32, 3);
const schnorrPK = PublicKey.fromKeyStore(createKeystore({ kind: 'schnorr', secret }, networkId));
const ecdsaPK = PublicKey.fromKeyStore(createKeystore({ kind: 'ecdsa', secret }, networkId));

// Type cast required because: JSON.parse returns `any`; the tests assert on the raw wire format of the snapshot
const parseSnapshot = (serialized: string): { publicKey: { publicKey: unknown } } =>
  JSON.parse(serialized) as { publicKey: { publicKey: unknown } };

const makeWallet = (publicKey: PublicKey): CoreWallet =>
  CoreWallet.restore(
    UnshieldedState.restore(
      [generateMockUtxoWithMeta({ owner: publicKey.addressHex, intentHash: 'intent-available', outputNo: 0 })],
      [
        {
          utxo: generateMockUtxoWithMeta({ owner: publicKey.addressHex, intentHash: 'intent-pending', outputNo: 1 }),
          ttl: TTL,
        },
      ],
    ),
    publicKey,
    { highestTransactionId: 5n, appliedId: 5n },
    ProtocolVersion.MinSupportedVersion,
    'undeployed',
  );

describe('default v2 serialization capability', () => {
  const capability = makeDefaultV2SerializationCapability();

  it('serializes the verifying key with its tag and round-trips a schnorr key', () => {
    const wallet = makeWallet(schnorrPK);

    const serialized = capability.serialize(wallet);
    const rawSnapshot = parseSnapshot(serialized);

    expect(rawSnapshot.publicKey.publicKey).toEqual({ tag: 'schnorr', value: schnorrPK.publicKey.value });

    const restored = capability.deserialize(serialized);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey).toEqual(schnorrPK);
      expect(UnshieldedState.toArrays(restored.right.state)).toEqual(UnshieldedState.toArrays(wallet.state));
      expect(restored.right.networkId).toBe(wallet.networkId);
      expect(restored.right.protocolVersion).toBe(wallet.protocolVersion);
    }
  });

  it('round-trips an ecdsa key preserving the tag', () => {
    const wallet = makeWallet(ecdsaPK);

    const serialized = capability.serialize(wallet);
    const rawSnapshot = parseSnapshot(serialized);

    expect(rawSnapshot.publicKey.publicKey).toEqual({ tag: 'ecdsa', value: ecdsaPK.publicKey.value });

    const restored = capability.deserialize(serialized);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey.publicKey).toEqual({ tag: 'ecdsa', value: ecdsaPK.publicKey.value });
    }
  });

  it('deserializes a legacy snapshot with a plain-string key as schnorr', () => {
    const legacySnapshot = JSON.stringify({
      publicKey: {
        publicKey: schnorrPK.publicKey.value,
        addressHex: schnorrPK.addressHex,
        address: schnorrPK.address,
      },
      state: {
        availableUtxos: [
          {
            utxo: {
              value: '100',
              owner: schnorrPK.addressHex,
              type: 'type1',
              intentHash: 'intent-available',
              outputNo: 0,
            },
            meta: {
              ctime: '2026-01-01T00:00:00.000Z',
              registeredForDustGeneration: true,
            },
          },
        ],
        pendingUtxos: [],
      },
      protocolVersion: '0',
      appliedId: '5',
      networkId: 'undeployed',
    });

    const restored = capability.deserialize(legacySnapshot);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey.publicKey).toEqual({ tag: 'schnorr', value: schnorrPK.publicKey.value });
      expect(UnshieldedState.toArrays(restored.right.state).availableUtxos).toHaveLength(1);
    }
  });

  it('rejects a snapshot with an unknown signature kind', () => {
    const tampered = JSON.stringify({
      publicKey: {
        publicKey: { tag: 'ed25519', value: schnorrPK.publicKey.value },
        addressHex: schnorrPK.addressHex,
        address: schnorrPK.address,
      },
      state: { availableUtxos: [], pendingUtxos: [] },
      protocolVersion: '0',
      appliedId: '5',
      networkId: 'undeployed',
    });

    const restored = capability.deserialize(tampered);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(SnapshotFormat.SnapshotRestoreError);
      // Unlabelled, so read as `v1`, the oldest version this reader accepts.
      expect(restored.left).toMatchObject({ surface: 'unshielded', reason: 'invalid-shape', detectedVersion: 'v1' });
    }
  });

  // Deserialization is a trust boundary: a relabelled or spliced snapshot must
  // be rejected, not silently accepted (#402 AC #4 — ECDSA-MM-09 / MM-01/02).
  // A key whose encoding length does not match its scheme tag cannot be decoded
  // by the ledger key decoder, so assertKeyAddressConsistency fails closed with
  // an OtherWalletError rather than letting the wasm trap escape.
  it('rejects an ecdsa-tagged key carrying a schnorr-length value (ECDSA-MM-09)', () => {
    const tampered = JSON.stringify({
      publicKey: {
        // ecdsa keys are 33-byte SEC1 (66 hex); this 32-byte (64 hex) value is a schnorr key relabelled as ecdsa
        publicKey: { tag: 'ecdsa', value: schnorrPK.publicKey.value },
        addressHex: schnorrPK.addressHex,
        address: schnorrPK.address,
      },
      state: { availableUtxos: [], pendingUtxos: [] },
      protocolVersion: '0',
      appliedId: '5',
      networkId: 'undeployed',
    });

    const restored = capability.deserialize(tampered);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(OtherWalletError);
    }
  });

  it('rejects a snapshot whose address does not derive from its key (ECDSA-MM-01/02)', () => {
    const spliced = JSON.stringify({
      publicKey: {
        // a valid schnorr key, but bundled with the ecdsa key's address
        publicKey: { tag: 'schnorr', value: schnorrPK.publicKey.value },
        addressHex: ecdsaPK.addressHex,
        address: ecdsaPK.address,
      },
      state: { availableUtxos: [], pendingUtxos: [] },
      protocolVersion: '0',
      appliedId: '5',
      networkId: 'undeployed',
    });

    const restored = capability.deserialize(spliced);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(SchemeMismatchError);
      expect((restored.left as SchemeMismatchError).at).toBe('construction');
    }
  });

  it('round-trips a wallet whose address derives from its key', () => {
    const wallet = makeWallet(schnorrPK);

    const restored = capability.deserialize(capability.serialize(wallet));

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey).toEqual(schnorrPK);
      expect(restored.right.progress.appliedId).toBe(5n);
      expect(restored.right.networkId).toBe(networkId);
    }
  });

  it('rejects a snapshot whose verifying key cannot be decoded, without letting the ledger throw escape', () => {
    // The key decoder lives in wasm and traps on a malformed key. On a trust boundary that must fail closed as a
    // typed Left, never as an exception thrown out of `deserialize`.
    const malformed = JSON.stringify({
      publicKey: {
        publicKey: { tag: 'schnorr', value: 'not-a-key' },
        addressHex: schnorrPK.addressHex,
        address: schnorrPK.address,
      },
      state: { availableUtxos: [], pendingUtxos: [] },
      protocolVersion: '0',
      appliedId: '5',
      networkId: 'undeployed',
    });

    const restored = capability.deserialize(malformed);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(OtherWalletError);
      expect(restored.left.message).toContain('could not be decoded');
    }
  });
});

describe('V2 unshielded snapshot format version', () => {
  const capability = makeDefaultV2SerializationCapability();

  const snapshotOf = (wallet: CoreWallet): Record<string, unknown> =>
    JSON.parse(capability.serialize(wallet)) as Record<string, unknown>;

  it('should stamp v2 into every snapshot it writes, because the tagged key is a retyped field', () => {
    expect(snapshotOf(makeWallet(schnorrPK))).toMatchObject({ version: 'v2' });
    expect(snapshotOf(makeWallet(ecdsaPK))).toMatchObject({
      version: 'v2',
      publicKey: { publicKey: { tag: 'ecdsa', value: ecdsaPK.publicKey.value } },
    });
  });

  it('should name itself as the writer of every snapshot it writes', () => {
    expect(snapshotOf(makeWallet(schnorrPK))).toMatchObject({ writtenBy: 'v2' });
  });

  it('should read a v1 snapshot — a bare-string key — by upgrading it in one step', () => {
    const v1 = JSON.stringify({
      ...snapshotOf(makeWallet(schnorrPK)),
      version: 'v1',
      publicKey: { publicKey: schnorrPK.publicKey.value, addressHex: schnorrPK.addressHex, address: schnorrPK.address },
    });

    const restored = capability.deserialize(v1);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey).toEqual(schnorrPK);
      expect(snapshotOf(restored.right)).toMatchObject({ version: 'v2' });
    }
  });

  it('should read a snapshot with no version and a tagged key, as the pre-release builds wrote them', () => {
    const { version: _version, ...unversioned } = snapshotOf(makeWallet(ecdsaPK));

    const restored = capability.deserialize(JSON.stringify(unversioned));

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey).toEqual(ecdsaPK);
    }
  });

  it('should read a snapshot labelled v1 whose key already carries its tag', () => {
    // The step fills in what is missing and never rewrites what is there; a tagged key under an old label decodes.
    const mislabelled = JSON.stringify({ ...snapshotOf(makeWallet(ecdsaPK)), version: 'v1' });

    expect(Either.isRight(capability.deserialize(mislabelled))).toBe(true);
  });

  it('should refuse a snapshot whose version this build does not know, and say which', () => {
    const fromANewerSdk = JSON.stringify({ ...snapshotOf(makeWallet(schnorrPK)), version: 'v3' });

    const restored = capability.deserialize(fromANewerSdk);
    const failure = Either.isLeft(restored) ? restored.left.message : 'the snapshot was restored';

    expect(failure).toContain(
      'Refusing an unshielded snapshot written in format version "v3": this build reads v2 and does not downgrade.',
    );
  });
});

/** One coin as the snapshot records it. `ttl` is present only on a pending entry. */
type PersistedEntry = {
  readonly utxo: { readonly intentHash: string; readonly outputNo: number; readonly value: string };
  readonly meta: { readonly ctime: string; readonly registeredForDustGeneration: boolean };
  readonly ttl?: string;
};

type PersistedSnapshot = {
  readonly state: {
    readonly availableUtxos: readonly PersistedEntry[];
    readonly pendingUtxos: readonly PersistedEntry[];
  };
};

const getOrThrow = <E, A>(either: Either.Either<A, E>): A =>
  pipe(
    either,
    Either.getOrThrowWith((e) => new Error(`Unexpected error: ${JSON.stringify(e)}`)),
  );

const walletHolding = (
  available: readonly UtxoWithMeta[],
  pending: ReadonlyArray<Omit<PendingUtxo, 'restored'>>,
): CoreWallet =>
  CoreWallet.restore(
    UnshieldedState.restore(available, pending),
    schnorrPK,
    { appliedId: 7n, highestTransactionId: 7n },
    ProtocolVersion.ProtocolVersion(1n),
    NetworkId.NetworkId.Undeployed,
  );

describe('V2 unshielded wallet serialization of bookings', () => {
  const capability = makeDefaultV2SerializationCapability();

  const persist = (wallet: CoreWallet): string => capability.serialize(wallet);
  const load = (snapshot: string): CoreWallet => getOrThrow(capability.deserialize(snapshot));
  const roundTrip = (wallet: CoreWallet): CoreWallet => load(persist(wallet));

  /**
   * The snapshot as written, so a test can assert on the persisted shape rather than on what we read back, and can edit
   * it to build a snapshot an older writer would have produced.
   *
   * Type cast required because: `JSON.parse` is untyped, and asserting on the persisted shape is the point here — a
   * decode through the schema would hide exactly the field layout under test.
   */
  const persistedShapeOf = (wallet: CoreWallet): PersistedSnapshot => JSON.parse(persist(wallet)) as PersistedSnapshot;

  describe('a booking across a persist and restore cycle', () => {
    it('carries the booking and its expiry, so a coin an abandoned swap still holds stays reserved', () => {
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-booked', outputNo: 0 });

      const restored = roundTrip(walletHolding([], [{ utxo: booked, ttl: TTL }]));

      expect(Option.getOrNull(HashMap.get(restored.state.pendingUtxos, utxoHash(booked)))).toEqual({
        utxo: booked,
        ttl: TTL,
        restored: true,
      });
      expect(HashMap.size(restored.state.availableUtxos)).toEqual(0);
    });

    it('keeps an available coin available', () => {
      const spendable = generateMockUtxoWithMeta({ intentHash: 'h-spendable', outputNo: 0 });

      const restored = roundTrip(walletHolding([spendable], []));

      expect(Option.getOrNull(HashMap.get(restored.state.availableUtxos, utxoHash(spendable)))).toEqual(spendable);
      expect(HashMap.size(restored.state.pendingUtxos)).toEqual(0);
    });

    it('writes each pending coin as its own fields plus a sibling expiry, not nested under a wrapper', () => {
      // The pending array keeps the shape it had before bookings carried an expiry, with `ttl` added beside `meta`.
      // A reader that predates the expiry therefore still finds every field it knows where it expects it.
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-shape', outputNo: 3 });

      const [entry] = persistedShapeOf(walletHolding([], [{ utxo: booked, ttl: TTL }])).state.pendingUtxos;

      expect(Object.keys(entry).toSorted()).toEqual(['meta', 'ttl', 'utxo']);
      expect(entry.utxo).toMatchObject({ intentHash: 'h-shape', outputNo: 3 });
      expect(entry.ttl).toEqual(TTL.toISOString());
    });

    it('writes no expiry against an available coin', () => {
      const spendable = generateMockUtxoWithMeta({ intentHash: 'h-no-ttl', outputNo: 0 });

      const [entry] = persistedShapeOf(walletHolding([spendable], [])).state.availableUtxos;

      expect(Object.keys(entry).toSorted()).toEqual(['meta', 'utxo']);
    });
  });

  describe('a snapshot written before bookings carried an expiry', () => {
    /** Such a snapshot is today's shape minus `ttl` on each pending entry. */
    const withoutExpiries = (wallet: CoreWallet): string => {
      const snapshot = persistedShapeOf(wallet);

      return JSON.stringify({
        ...snapshot,
        state: {
          ...snapshot.state,
          pendingUtxos: snapshot.state.pendingUtxos.map(({ ttl: _ttl, ...rest }) => rest),
        },
      });
    };

    it('decodes, rather than being rejected as malformed', () => {
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-legacy', outputNo: 0 });

      const result = capability.deserialize(withoutExpiries(walletHolding([], [{ utxo: booked, ttl: TTL }])));

      expect(Either.isRight(result)).toBe(true);
    });

    it('decodes when it is also a v1 snapshot, whose bare-string key the upgrade step tags', () => {
      // A V1 variant of an SDK that predates booking expiries wrote both: no `ttl`, and an untagged key. The upgrade
      // step only tags the key, so the missing expiry is still the schema's to fill in.
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-legacy-v1', outputNo: 0 });
      // Type cast required because: `JSON.parse` is untyped, and the snapshot is edited as raw JSON on purpose.
      const legacy = JSON.parse(withoutExpiries(walletHolding([], [{ utxo: booked, ttl: TTL }]))) as Record<
        string,
        unknown
      >;
      const v1WithoutExpiries = JSON.stringify({
        ...legacy,
        version: 'v1',
        publicKey: {
          publicKey: schnorrPK.publicKey.value,
          addressHex: schnorrPK.addressHex,
          address: schnorrPK.address,
        },
      });

      const restored = load(v1WithoutExpiries);

      expect(restored.publicKey).toEqual(schnorrPK);
      expect(HashMap.has(restored.state.pendingUtxos, utxoHash(booked))).toBe(true);
    });

    it('gives the booking a full transaction lifetime from now, rather than an expiry already behind it', () => {
      // The snapshot does not say when these coins were booked, and the writing process may have submitted the
      // transaction moments before it stopped. Dating them in the past would release a coin that a live transaction
      // is still spending; dating them a lifetime ahead releases them only once no transaction could still be
      // accepted, which is the same bound every other booking gets.
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-legacy-sweep', outputNo: 0 });
      const loadedAt = Date.now();

      const restored = load(withoutExpiries(walletHolding([], [{ utxo: booked, ttl: TTL }])));
      const entry = Option.getOrThrow(HashMap.get(restored.state.pendingUtxos, utxoHash(booked)));

      expect(entry.ttl.getTime()).toBeGreaterThanOrEqual(loadedAt + LEGACY_BOOKING_LIFETIME_MS);
      expect(entry.restored).toBe(true);

      const sweptWithinLifetime = CoreWallet.expirePending(restored, new Date(loadedAt));
      expect(HashMap.has(sweptWithinLifetime.state.pendingUtxos, utxoHash(booked))).toBe(true);

      const sweptAfterLifetime = CoreWallet.expirePending(restored, new Date(entry.ttl.getTime() + 1));
      expect(HashMap.has(sweptAfterLifetime.state.availableUtxos, utxoHash(booked))).toBe(true);
      expect(HashMap.size(sweptAfterLifetime.state.pendingUtxos)).toEqual(0);
    });
  });

  describe('a snapshot holding the same coin as both available and pending', () => {
    /**
     * The corruption a leaked booking produced: one coin written into both arrays. Built by copying the persisted
     * pending entry, minus its expiry, into the available array, so both records are the same coin as written.
     */
    const withPendingAlsoAvailable = (wallet: CoreWallet): string => {
      const snapshot = persistedShapeOf(wallet);

      return JSON.stringify({
        ...snapshot,
        state: {
          ...snapshot.state,
          availableUtxos: [
            ...snapshot.state.availableUtxos,
            ...snapshot.state.pendingUtxos.map(({ ttl: _ttl, ...rest }) => rest),
          ],
        },
      });
    };

    it('loads with the coin on the pending side only, so its balance is counted once', () => {
      const duplicated = generateMockUtxoWithMeta({ intentHash: 'h-duplicated', outputNo: 0 });

      const restored = load(withPendingAlsoAvailable(walletHolding([], [{ utxo: duplicated, ttl: TTL }])));

      expect(HashMap.has(restored.state.availableUtxos, utxoHash(duplicated))).toBe(false);
      expect(HashMap.size(restored.state.pendingUtxos)).toEqual(1);
    });
  });

  describe('the rest of the snapshot', () => {
    it('round-trips the public key, protocol version, network and applied cursor', () => {
      const wallet = walletHolding([generateMockUtxoWithMeta({ intentHash: 'h-meta', outputNo: 0 })], []);

      const restored = roundTrip(wallet);

      expect(restored.publicKey).toEqual(wallet.publicKey);
      expect(restored.protocolVersion).toEqual(wallet.protocolVersion);
      expect(restored.networkId).toEqual(wallet.networkId);
      expect(restored.progress.appliedId).toEqual(7n);
    });
  });
});
