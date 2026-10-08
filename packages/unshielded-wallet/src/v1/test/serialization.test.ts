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
// Deserialization is a trust boundary: a snapshot is whatever was handed back to us. The ledger-v9 variant checks
// there that a snapshot's address really derives from its verifying key, and reports a mismatch as the cross-scheme
// mix it is. Only the SCHEME LABELLING of that error is v9-only — ledger-v8 has a single signature scheme — so the v8
// variant makes the same assertion and reports it as an ordinary wallet error.
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, HashMap, Option, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { createKeystore, PublicKey } from '../KeyStore.js';
import { makeDefaultV1SerializationCapability, LEGACY_BOOKING_LIFETIME_MS } from '../Serialization.js';
import { type PendingUtxo, UnshieldedState, UtxoWithMeta } from '../UnshieldedState.js';
import { OtherWalletError } from '../WalletError.js';
import { generateMockUtxoWithMeta, utxoHash } from './testUtils.js';

const networkId = NetworkId.NetworkId.Undeployed;

// Two real, self-consistent keys: each address derives from its own key, so only deliberate splicing can break the
// consistency the capability asserts.
const ownPK = PublicKey.fromKeyStore(createKeystore(Buffer.alloc(32, 3), networkId));
const foreignPK = PublicKey.fromKeyStore(createKeystore(Buffer.alloc(32, 7), networkId));

const utxoOf = (owner: ledger.UserAddress, intentHash: string, outputNo: number): UtxoWithMeta =>
  new UtxoWithMeta({
    utxo: { value: 42n, owner, type: ledger.nativeToken().raw, intentHash, outputNo },
    meta: { ctime: new Date(0), registeredForDustGeneration: false },
  });

const walletOf = (publicKey: PublicKey): CoreWallet =>
  CoreWallet.restore(
    UnshieldedState.restore(
      [utxoOf(publicKey.addressHex, 'intent-available', 0)],
      [{ utxo: utxoOf(publicKey.addressHex, 'intent-pending', 1), ttl: new Date('2026-01-01T01:00:00.000Z') }],
    ),
    publicKey,
    { highestTransactionId: 5n, appliedId: 5n },
    ProtocolVersion.MinSupportedVersion,
    networkId,
  );

const snapshotWithPublicKey = (publicKey: PublicKey['publicKey'], addressHex: string, address: string): string =>
  JSON.stringify({
    publicKey: { publicKey, addressHex, address },
    state: { availableUtxos: [], pendingUtxos: [] },
    protocolVersion: '0',
    appliedId: '5',
    networkId: 'undeployed',
  });

describe('default v1 serialization capability', () => {
  const capability = makeDefaultV1SerializationCapability();

  it('round-trips a wallet whose address derives from its key', () => {
    const wallet = walletOf(ownPK);

    const restored = capability.deserialize(capability.serialize(wallet));

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey).toEqual(ownPK);
      expect(restored.right.progress.appliedId).toBe(5n);
      expect(restored.right.networkId).toBe(networkId);
    }
  });

  it('rejects a snapshot whose address does not derive from its key', () => {
    // A valid verifying key bundled with somebody else's address. Nothing in the schema can catch this: both fields
    // are well-formed strings, and only deriving one from the other shows they do not belong together.
    const spliced = snapshotWithPublicKey(ownPK.publicKey, foreignPK.addressHex, foreignPK.address);

    const restored = capability.deserialize(spliced);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(OtherWalletError);
      expect(restored.left.message).toContain('does not match its verifying key');
    }
  });

  it('rejects a snapshot whose verifying key cannot be decoded, without letting the ledger throw escape', () => {
    // The key decoder lives in wasm and traps on a malformed key. On a trust boundary that must fail closed as a
    // typed Left, never as an exception thrown out of `deserialize`.
    const malformed = snapshotWithPublicKey('not-a-key', ownPK.addressHex, ownPK.address);

    const restored = capability.deserialize(malformed);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(OtherWalletError);
      expect(restored.left.message).toContain('could not be decoded');
    }
  });
});

const TTL = new Date('2026-01-01T01:00:00.000Z');

const keystore = createKeystore(Buffer.from(ledger.sampleSigningKey(), 'hex'), NetworkId.NetworkId.Undeployed);
const ownerPublicKey = PublicKey.fromKeyStore(keystore);

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
    ownerPublicKey,
    { appliedId: 7n, highestTransactionId: 7n },
    ProtocolVersion.ProtocolVersion(1n),
    NetworkId.NetworkId.Undeployed,
  );

describe('Unshielded wallet serialization', () => {
  const capability = makeDefaultV1SerializationCapability();

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
