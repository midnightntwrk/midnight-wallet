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
import { DustWallet, type DefaultDustConfiguration } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { TransactionHistory as DustTransactionHistory } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import { ShieldedWallet, type DefaultShieldedConfiguration } from '@midnightntwrk/wallet-sdk-shielded';
import { TransactionHistory as ShieldedTransactionHistory } from '@midnightntwrk/wallet-sdk-shielded/v2';
import { UnshieldedWallet, type DefaultUnshieldedConfiguration } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { TransactionHistory as UnshieldedTransactionHistory } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { currentVersionOf, declaredVersionOf, fixturesFor } from './fixtures.js';
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
} from './walletProjections.js';

/**
 * Does a snapshot a published release wrote still open through the **wallet** an application actually holds?
 *
 * The compatibility tests next door ask a narrower question. They call `makeDefaultV1SerializationCapability()` and
 * friends directly, which is the right unit for "does this reader parse those bytes" — but it is not the object an
 * application has. An application has a `ShieldedWallet` / `UnshieldedWallet` / `DustWallet`, hands it a string, and
 * expects a wallet back with its money in it. Between the two sits `variantForSnapshot`, which picks a reader by the
 * snapshot's `protocolVersion` — a decision no frozen fixture had ever been put through until this file existed.
 *
 * That seam is where a format version and a routing rule can disagree. The snapshot says which _shape_ it is; the
 * routing says which _variant_ reads it; nothing makes the two agree by construction. A fixture that restores perfectly
 * through a capability can still be handed to the wrong reader and refused.
 *
 * Every assertion here is made against the fixture's own recorded `expected` block, reached through the public wallet
 * API — the balances, coins, address and sync point an application reads — rather than off the core state. A payload
 * whose bytes parse but whose money is not reachable has not really been restored.
 *
 * Both twins are registered, so each fixture routes to the variant that owns its `protocolVersion`; every frozen
 * snapshot predates `forks.v9`, so they all land on V1. A build that registers only the V2 variant is the other half of
 * the question and is not this file's.
 */

/** Shared by all three wallets. The fork is the default boundary, so routing behaves as it does in a real build. */
const baseConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  forks: { v9: ProtocolVersion.ProtocolVersion(2_000_000n) },
} as const;

/**
 * A fresh history storage per wallet.
 *
 * Restoring does not write history, but a storage shared between cases would let one case observe another's state, and
 * the point of these cases is that each is decided by its own fixture alone.
 */
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

describe('shielded snapshots written by published releases, opened through the wallet', () => {
  const fixtures = fixturesFor('shielded');

  it('should have fixtures to open', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    it('should route to a registered variant and come back as a wallet', () => {
      const restored = ShieldedWallet(shieldedConfiguration()).tryRestore(fixture.serialized);

      expect(Either.isRight(restored)).toBe(true);
    });

    it('should expose through the wallet API exactly what the payload was written with', async () => {
      const { state, reserialized } = await openWallet<ShieldedState>(fixture, (s) =>
        ShieldedWallet(shieldedConfiguration()).tryRestore(s),
      );

      expect(project(fixture, shieldedValue(fixture, state, reserialized))).toEqual(recorded(fixture));
    });

    it('should write the snapshot back at the version the variant it routed to owns', async () => {
      const { reserialized } = await openWallet<ShieldedState>(fixture, (s) =>
        ShieldedWallet(shieldedConfiguration()).tryRestore(s),
      );

      expect(declaredVersionOf(reserialized)).toBe(currentVersionOf.v1['shielded']);
    });

    it('should open its own re-written snapshot to the same content', async () => {
      const first = await openWallet<ShieldedState>(fixture, (s) =>
        ShieldedWallet(shieldedConfiguration()).tryRestore(s),
      );
      const second = await openWallet<ShieldedState>({ ...fixture, serialized: first.reserialized }, (s) =>
        ShieldedWallet(shieldedConfiguration()).tryRestore(s),
      );

      expect(project(fixture, shieldedValue(fixture, second.state, second.reserialized))).toEqual(
        project(fixture, shieldedValue(fixture, first.state, first.reserialized)),
      );
    });
  });
});

describe('unshielded snapshots written by published releases, opened through the wallet', () => {
  const fixtures = fixturesFor('unshielded');

  it('should have fixtures to open', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    it('should route to a registered variant and come back as a wallet', () => {
      const restored = UnshieldedWallet(unshieldedConfiguration()).tryRestore(fixture.serialized);

      expect(Either.isRight(restored)).toBe(true);
    });

    it('should expose through the wallet API exactly what the payload was written with', async () => {
      const { state, reserialized } = await openWallet<UnshieldedState>(fixture, (s) =>
        UnshieldedWallet(unshieldedConfiguration()).tryRestore(s),
      );

      expect(project(fixture, unshieldedValue(fixture, state, reserialized))).toEqual(
        pairRegisteredFlags(recorded(fixture)),
      );
    });

    // The one surface whose two writers are on different format versions. A snapshot that routes to V1 must come back
    // as `v1`: were routing to hand it to V2, it would come back `v2` with a retyped key, and the next V1 build to
    // read it would refuse it.
    it('should write the snapshot back at the version the variant it routed to owns', async () => {
      const { reserialized } = await openWallet<UnshieldedState>(fixture, (s) =>
        UnshieldedWallet(unshieldedConfiguration()).tryRestore(s),
      );

      expect(declaredVersionOf(reserialized)).toBe(currentVersionOf.v1['unshielded']);
    });

    it('should open its own re-written snapshot to the same content', async () => {
      const first = await openWallet<UnshieldedState>(fixture, (s) =>
        UnshieldedWallet(unshieldedConfiguration()).tryRestore(s),
      );
      const second = await openWallet<UnshieldedState>({ ...fixture, serialized: first.reserialized }, (s) =>
        UnshieldedWallet(unshieldedConfiguration()).tryRestore(s),
      );

      expect(project(fixture, unshieldedValue(fixture, second.state, second.reserialized))).toEqual(
        project(fixture, unshieldedValue(fixture, first.state, first.reserialized)),
      );
    });
  });
});

describe('dust snapshots written by published releases, opened through the wallet', () => {
  const fixtures = fixturesFor('dust');

  it('should have fixtures to open', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    it('should route to a registered variant and come back as a wallet', () => {
      const restored = DustWallet(dustConfiguration()).tryRestore(fixture.serialized);

      expect(Either.isRight(restored)).toBe(true);
    });

    it('should expose through the wallet API exactly what the payload was written with', async () => {
      const { state } = await openWallet<DustState>(fixture, (s) => DustWallet(dustConfiguration()).tryRestore(s));

      expect(project(fixture, dustValue(fixture, state))).toEqual(recorded(fixture));
    });

    it('should write the snapshot back at the version the variant it routed to owns', async () => {
      const { reserialized } = await openWallet<DustState>(fixture, (s) =>
        DustWallet(dustConfiguration()).tryRestore(s),
      );

      expect(declaredVersionOf(reserialized)).toBe(currentVersionOf.v1['dust']);
    });

    it('should open its own re-written snapshot to the same content', async () => {
      const first = await openWallet<DustState>(fixture, (s) => DustWallet(dustConfiguration()).tryRestore(s));
      const second = await openWallet<DustState>({ ...fixture, serialized: first.reserialized }, (s) =>
        DustWallet(dustConfiguration()).tryRestore(s),
      );

      expect(project(fixture, dustValue(fixture, second.state))).toEqual(
        project(fixture, dustValue(fixture, first.state)),
      );
    });
  });
});
