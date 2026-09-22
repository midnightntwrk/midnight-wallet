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
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { CustomDustWallet, type DefaultDustConfiguration } from '@midnightntwrk/wallet-sdk-dust-wallet';
import {
  TransactionHistory as DustTransactionHistory,
  V2Builder as DustV2Builder,
} from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import { CustomShieldedWallet, type DefaultShieldedConfiguration } from '@midnightntwrk/wallet-sdk-shielded';
import {
  TransactionHistory as ShieldedTransactionHistory,
  V2Builder as ShieldedV2Builder,
} from '@midnightntwrk/wallet-sdk-shielded/v2';
import {
  CustomUnshieldedWallet,
  type DefaultUnshieldedConfiguration,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import {
  TransactionHistory as UnshieldedTransactionHistory,
  V2Builder as UnshieldedV2Builder,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { currentVersionOf, declaredVersionOf, fixturesFor, type Fixture } from './fixtures.js';
import {
  dustValue,
  openWallet,
  pairRegisteredFlags,
  project,
  recorded,
  shieldedValue,
  unshieldedValue,
  type DustState,
  type ShieldedState,
  type UnshieldedState,
  type WalletHandle,
} from './walletProjections.js';

/**
 * The other half of the wallet-layer question: a build that registers **only** the V2 variant, opening what a V1 wallet
 * stored.
 *
 * Its sibling file covers the dual-variant build, where every frozen snapshot routes to the variant that owns its
 * protocol version — which, for a corpus written entirely below `forks.v9`, is always V1. That leaves the V2 readers
 * untravelled at the wallet layer, and they are not a hypothetical: `CustomShieldedWallet` and friends are the
 * single-variant composition an application pins itself to, and a build composed that way has only V2 to open a
 * snapshot with, whatever version the snapshot declares. `CustomUnshieldedWallet` registers its variant at
 * `MinSupportedVersion`, so that one variant answers for the whole protocol timeline.
 *
 * For unshielded this is the only path on which the `v1 → v2` upgrade step runs at all. The V1 writer stores the
 * verifying key as a bare string and the V2 writer stores it as `{ tag, value }`, so a V1-written snapshot reaching a
 * V2 reader must be upgraded before the schema sees it — and must come back out carrying the same key, under the same
 * address, at `v2`. Shielded and dust write one shape from both variants, so they come back at `v1` unchanged; that
 * they do is asserted here rather than assumed, because it is the thing that would change if either surface were bumped
 * on one twin alone.
 */

const baseConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  forks: { v9: ProtocolVersion.ProtocolVersion(2_000_000n) },
} as const;

const shieldedConfiguration = (): DefaultShieldedConfiguration => ({
  ...baseConfiguration,
  txHistoryStorage: new InMemoryTransactionHistoryStorage(
    ShieldedTransactionHistory.ShieldedTransactionHistoryEntrySchema,
  ),
});

const unshieldedConfiguration = (): DefaultUnshieldedConfiguration => ({
  ...baseConfiguration,
  txHistoryStorage: new InMemoryTransactionHistoryStorage(
    UnshieldedTransactionHistory.UnshieldedTransactionHistoryEntrySchema,
  ),
});

const dustConfiguration = (): DefaultDustConfiguration => ({
  ...baseConfiguration,
  txHistoryStorage: new InMemoryTransactionHistoryStorage(DustTransactionHistory.DustTransactionHistoryEntrySchema),
  costParameters: { feeBlocksMargin: 0 },
});

/**
 * A single-variant wallet exposes `restore`, which throws, rather than the `tryRestore` its multi-variant sibling has.
 * Catching here turns that back into a value, so a refusal is reported against the fixture that caused it instead of as
 * a bare stack from inside the reader.
 */
const restoring =
  (restore: (serialized: string) => WalletHandle) =>
  (serialized: string): Either.Either<WalletHandle, unknown> =>
    Either.try({ try: () => restore(serialized), catch: (cause) => cause });

const shieldedV2Only = () =>
  CustomShieldedWallet<DefaultShieldedConfiguration>(shieldedConfiguration(), new ShieldedV2Builder().withDefaults());

const unshieldedV2Only = () =>
  CustomUnshieldedWallet<DefaultUnshieldedConfiguration>(
    unshieldedConfiguration(),
    new UnshieldedV2Builder().withDefaults(),
  );

const dustV2Only = () =>
  CustomDustWallet<DefaultDustConfiguration>(dustConfiguration(), new DustV2Builder().withDefaults());

/** The key a snapshot carries, however the writer of the day spelled it. */
const keyOf = (serialized: string): unknown =>
  (JSON.parse(serialized) as { publicKey: { publicKey: unknown } }).publicKey.publicKey;

const addressOf = (serialized: string): string =>
  (JSON.parse(serialized) as { publicKey: { address: string } }).publicKey.address;

describe('shielded snapshots written by published releases, opened by a V2-only build', () => {
  describe.each(fixturesFor('shielded'))('$id (written by $writtenBy.name $writtenBy.version)', (fixture: Fixture) => {
    it('should open with only the V2 variant registered', async () => {
      const { state, reserialized } = await openWallet<ShieldedState>(
        fixture,
        restoring((s) => shieldedV2Only().restore(s)),
      );

      expect(project(fixture, shieldedValue(fixture, state, reserialized))).toEqual(recorded(fixture));
    });

    // Both twins write one shape, so the V2 writer must not invent a version of its own. If shielded were ever bumped
    // on one twin alone, this is where that shows up.
    it('should write it back at the version the V2 writer owns', async () => {
      const { reserialized } = await openWallet<ShieldedState>(
        fixture,
        restoring((s) => shieldedV2Only().restore(s)),
      );

      expect(declaredVersionOf(reserialized)).toBe(currentVersionOf.v2['shielded']);
    });

    it('should open its own re-written snapshot to the same content', async () => {
      const first = await openWallet<ShieldedState>(
        fixture,
        restoring((s) => shieldedV2Only().restore(s)),
      );
      const second = await openWallet<ShieldedState>(
        { ...fixture, serialized: first.reserialized },
        restoring((s) => shieldedV2Only().restore(s)),
      );

      expect(project(fixture, shieldedValue(fixture, second.state, second.reserialized))).toEqual(
        project(fixture, shieldedValue(fixture, first.state, first.reserialized)),
      );
    });
  });
});

describe('unshielded snapshots written by published releases, opened by a V2-only build', () => {
  describe.each(fixturesFor('unshielded'))(
    '$id (written by $writtenBy.name $writtenBy.version)',
    (fixture: Fixture) => {
      it('should open with only the V2 variant registered, upgrading on the way in', async () => {
        const { state, reserialized } = await openWallet<UnshieldedState>(
          fixture,
          restoring((s) => unshieldedV2Only().restore(s)),
        );

        expect(project(fixture, unshieldedValue(fixture, state, reserialized))).toEqual(
          pairRegisteredFlags(recorded(fixture)),
        );
      });

      it('should write it back at the version the V2 writer owns, which is not the one it read', async () => {
        const { reserialized } = await openWallet<UnshieldedState>(
          fixture,
          restoring((s) => unshieldedV2Only().restore(s)),
        );

        expect(declaredVersionOf(fixture.serialized)).toBe('v1');
        expect(declaredVersionOf(reserialized)).toBe(currentVersionOf.v2['unshielded']);
      });

      // The upgrade's whole job, and the one thing a path check could not see: the bare string the payload stored must
      // come back as that same string inside a schnorr tag, under the address it was stored with. A step that
      // re-derived either — from the state, from a default — would still produce a well-formed `v2` snapshot and would
      // have silently changed the wallet's identity.
      it('should tag the stored verifying key without changing it or its address', async () => {
        const { reserialized } = await openWallet<UnshieldedState>(
          fixture,
          restoring((s) => unshieldedV2Only().restore(s)),
        );

        // Read off the payload's own bytes, so the case states the shape it is upgrading from rather than assuming it.
        expect(typeof keyOf(fixture.serialized)).toBe('string');
        expect(keyOf(reserialized)).toEqual({ tag: 'schnorr', value: keyOf(fixture.serialized) });
        expect(addressOf(reserialized)).toBe(addressOf(fixture.serialized));
      });

      // Reading back its own output is reading a `v2` payload, which is the half of the step nothing else exercises:
      // the upgrade must leave an already-tagged key alone rather than tagging it twice.
      it('should open its own re-written v2 snapshot to the same content', async () => {
        const first = await openWallet<UnshieldedState>(
          fixture,
          restoring((s) => unshieldedV2Only().restore(s)),
        );
        const second = await openWallet<UnshieldedState>(
          { ...fixture, serialized: first.reserialized },
          restoring((s) => unshieldedV2Only().restore(s)),
        );

        expect(keyOf(second.reserialized)).toEqual(keyOf(first.reserialized));
        expect(project(fixture, unshieldedValue(fixture, second.state, second.reserialized))).toEqual(
          project(fixture, unshieldedValue(fixture, first.state, first.reserialized)),
        );
      });
    },
  );
});

describe('dust snapshots written by published releases, opened by a V2-only build', () => {
  describe.each(fixturesFor('dust'))('$id (written by $writtenBy.name $writtenBy.version)', (fixture: Fixture) => {
    it('should open with only the V2 variant registered', async () => {
      const { state } = await openWallet<DustState>(
        fixture,
        restoring((s) => dustV2Only().restore(s)),
      );

      expect(project(fixture, dustValue(fixture, state))).toEqual(recorded(fixture));
    });

    it('should write it back at the version the V2 writer owns', async () => {
      const { reserialized } = await openWallet<DustState>(
        fixture,
        restoring((s) => dustV2Only().restore(s)),
      );

      expect(declaredVersionOf(reserialized)).toBe(currentVersionOf.v2['dust']);
    });

    it('should open its own re-written snapshot to the same content', async () => {
      const first = await openWallet<DustState>(
        fixture,
        restoring((s) => dustV2Only().restore(s)),
      );
      const second = await openWallet<DustState>(
        { ...fixture, serialized: first.reserialized },
        restoring((s) => dustV2Only().restore(s)),
      );

      expect(project(fixture, dustValue(fixture, second.state))).toEqual(
        project(fixture, dustValue(fixture, first.state)),
      );
    });
  });
});
