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
import { firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { currentVersionOf, declaredVersionOf, fixturesFor, type Fixture } from './fixtures.js';

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

/**
 * What one fixture looks like once the wallet has opened it: the state the application would read, and the snapshot the
 * wallet writes back.
 */
type Opened<TState> = {
  readonly state: TState;
  readonly reserialized: string;
};

/**
 * All three wallets, described by the three members this file uses.
 *
 * Structural rather than generic over the wallet type: the three are unrelated classes, and naming only what is read
 * here lets one helper serve all of them without a cast at each call site.
 */
type WalletHandle = {
  readonly state: Observable<unknown>;
  serializeState: () => Promise<string>;
  stop: () => Promise<void>;
};

/**
 * Open a stored payload with a wallet, read its state and its re-written snapshot, then stop it.
 *
 * `tryRestore` is used rather than `restore` so a refusal arrives as a value this helper can name, instead of a throw
 * from somewhere inside the routing. The state is typed by the caller, which knows which wallet it asked for; the
 * wallet itself stays structural.
 */
const open = async <TState>(
  fixture: Fixture,
  tryRestore: (serialized: string) => Either.Either<WalletHandle, unknown>,
): Promise<Opened<TState>> => {
  const restored = tryRestore(fixture.serialized);
  if (Either.isLeft(restored)) {
    throw new Error(`${fixture.id} did not restore through the wallet: ${String(restored.left)}`);
  }
  const wallet = restored.right;
  try {
    const state = (await firstValueFrom(wallet.state)) as TState;
    return { state, reserialized: await wallet.serializeState() };
  } finally {
    await wallet.stop();
  }
};

/** Values as the fixtures record them: decimal strings, so a `bigint` and its record never differ by representation. */
const asStrings = (values: Iterable<bigint>): readonly string[] => [...values].map(String).sort();

/**
 * The one thing a frozen fixture records that no wallet API exposes.
 *
 * `backingNightValue` is the value of the Night UTxO backing a Dust generation, which lives inside the ledger's
 * `DustLocalState` and is not projected onto the wallet state. It is asserted at the capability level; naming it here
 * keeps the omission deliberate and visible rather than silent.
 */
const NOT_REACHABLE_THROUGH_THE_WALLET: ReadonlySet<string> = new Set(['backingNightValue']);

/** The recorded expectations this file is answerable for: everything the fixture states, minus the exclusion above. */
const answerableKeys = (fixture: Fixture): readonly string[] =>
  Object.keys(fixture.expected)
    .filter((key) => !NOT_REACHABLE_THROUGH_THE_WALLET.has(key))
    .sort();

/** The fixture's own record, narrowed to the keys this file answers, for a whole-object comparison. */
const recorded = (fixture: Fixture): Record<string, unknown> =>
  Object.fromEntries(answerableKeys(fixture).map((key) => [key, fixture.expected[key]]));

/**
 * Project the wallet's state into the same shape the fixture records.
 *
 * Whole-object rather than key-by-key on purpose: a key added to a fixture with no accessor here throws instead of
 * being quietly skipped, so the corpus cannot grow past what this file checks.
 */
const project = (fixture: Fixture, value: (key: string) => unknown): Record<string, unknown> =>
  Object.fromEntries(answerableKeys(fixture).map((key) => [key, value(key)]));

type ShieldedState = {
  readonly balances: Record<string, bigint>;
  readonly availableCoins: readonly { readonly coin: { readonly type: string; readonly value: bigint } }[];
  readonly state: {
    readonly networkId: string;
    // Type cast required because: the ledger's `ZswapLocalState` is not re-exported by this package, and `firstFree`
    // is the only member read here.
    readonly state: { readonly firstFree: bigint; readonly pendingSpends: ReadonlyMap<unknown, unknown> };
  };
};

type UnshieldedState = {
  readonly balances: Record<string, bigint>;
  readonly availableCoins: readonly {
    readonly utxo: { readonly type: string; readonly value: bigint };
    readonly meta: { readonly registeredForDustGeneration: boolean };
  }[];
  readonly pendingCoins: readonly { readonly utxo: { readonly value: bigint } }[];
  readonly address: { readonly hexString: string };
  readonly progress: { readonly appliedId: bigint };
  readonly state: { readonly networkId: string };
};

type DustState = {
  readonly publicKey: bigint;
  readonly totalCoins: readonly unknown[];
  readonly state: { readonly networkId: string };
};

/** Coin values of one token, as the fixtures record them. */
const shieldedValuesOf = (state: ShieldedState, token: unknown): readonly string[] =>
  asStrings(state.availableCoins.filter((entry) => entry.coin.type === token).map((entry) => entry.coin.value));

/**
 * The balance of the second token, for a fixture that records the balance but not the token it belongs to.
 *
 * The `-pending` fixtures do exactly that. Rather than hardcode the generator's token constant — knowledge the fixture
 * does not state, and a value this file would then be asserting against itself — the second token is derived as the one
 * token in the restored balances that is not `tokenA`. Deriving it is only sound while there is exactly one, so that is
 * checked rather than assumed.
 */
const otherTokenBalance = (state: ShieldedState, tokenA: unknown): string => {
  const others = Object.entries(state.balances).filter(([token]) => token !== tokenA);
  const only = others[0];
  if (others.length !== 1 || only === undefined) {
    throw new Error(
      `cannot derive the second token's balance: expected exactly one token besides tokenA, found ${others.length}`,
    );
  }
  return String(only[1]);
};

const shieldedValue =
  (fixture: Fixture, state: ShieldedState, reserialized: string) =>
  (key: string): unknown => {
    switch (key) {
      case 'networkId':
        return state.state.networkId;
      // The token keys are what the value keys below look up, so asserting them is not bookkeeping: it says the
      // restored wallet still holds a balance under the very token the payload was written with. A token that did not
      // survive the restore reports itself here rather than silently turning every balance under it into zero.
      case 'tokenA':
      case 'tokenB':
        return Object.keys(state.balances).find((token) => token === fixture.expected[key]) ?? 'absent from balances';
      case 'balanceA':
        return String(state.balances[fixture.expected['tokenA'] as string] ?? 0n);
      case 'balanceB':
        return fixture.expected['tokenB'] === undefined
          ? otherTokenBalance(state, fixture.expected['tokenA'])
          : String(state.balances[fixture.expected['tokenB'] as string] ?? 0n);
      case 'coinValuesA':
      case 'availableValuesA':
        return shieldedValuesOf(state, fixture.expected['tokenA']);
      case 'coinValuesB':
        return shieldedValuesOf(state, fixture.expected['tokenB']);
      case 'coinCount':
        return state.availableCoins.length;
      case 'firstFree':
        return String(state.state.state.firstFree);
      case 'pendingSpendCount':
        return state.state.state.pendingSpends.size;
      // The field a 1.0.0 snapshot embedded its history in. It is not projected onto the wallet state — nothing in the
      // SDK reads it — so the only honest place to see it is the snapshot the wallet writes back, which is also the
      // write that used to lose it.
      case 'embeddedTxHistoryCount':
        return ((JSON.parse(reserialized) as { txHistory?: readonly string[] }).txHistory ?? []).length;
      default:
        throw new Error(`no wallet-layer accessor for recorded key '${key}'`);
    }
  };

const unshieldedValue =
  (fixture: Fixture, state: UnshieldedState, reserialized: string) =>
  (key: string): unknown => {
    switch (key) {
      case 'networkId':
        return state.state.networkId;
      case 'nightToken':
      case 'customToken':
        return fixture.expected[key];
      case 'availableValues':
        return asStrings(state.availableCoins.map((entry) => entry.utxo.value));
      case 'pendingValues':
        return asStrings(state.pendingCoins.map((entry) => entry.utxo.value));
      // Paired with the value rather than listed alone: sorting the flags on their own would compare two lists that
      // happen to be the same length and say nothing about which UTxO is registered.
      case 'registeredFlags':
        return state.availableCoins
          .map((entry) => `${entry.utxo.value}:${entry.meta.registeredForDustGeneration}`)
          .sort();
      case 'appliedId':
        return String(state.progress.appliedId);
      // The address the wallet reports, read back off the snapshot it writes: the state exposes the address as bytes,
      // and the bech32 form is what an application shows a user and what the fixture recorded.
      case 'address':
        return (JSON.parse(reserialized) as { publicKey: { address: string } }).publicKey.address;
      default:
        throw new Error(`no wallet-layer accessor for recorded key '${key}'`);
    }
  };

const dustValue =
  (_fixture: Fixture, state: DustState) =>
  (key: string): unknown => {
    switch (key) {
      case 'networkId':
        return state.state.networkId;
      case 'publicKey':
        return String(state.publicKey);
      case 'dustUtxoCount':
        return state.totalCoins.length;
      default:
        throw new Error(`no wallet-layer accessor for recorded key '${key}'`);
    }
  };

/** `registeredFlags` is recorded positionally against `availableValues`; the projection pairs them, so must this. */
const pairRegisteredFlags = (expectation: Record<string, unknown>): Record<string, unknown> =>
  'registeredFlags' in expectation
    ? {
        ...expectation,
        registeredFlags: (expectation['availableValues'] as readonly string[])
          .map((value, index) => `${value}:${(expectation['registeredFlags'] as readonly boolean[])[index]}`)
          .sort(),
      }
    : expectation;

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
      const { state, reserialized } = await open<ShieldedState>(fixture, (s) =>
        ShieldedWallet(shieldedConfiguration()).tryRestore(s),
      );

      expect(project(fixture, shieldedValue(fixture, state, reserialized))).toEqual(recorded(fixture));
    });

    it('should write the snapshot back at the version the variant it routed to owns', async () => {
      const { reserialized } = await open<ShieldedState>(fixture, (s) =>
        ShieldedWallet(shieldedConfiguration()).tryRestore(s),
      );

      expect(declaredVersionOf(reserialized)).toBe(currentVersionOf.v1['shielded']);
    });

    it('should open its own re-written snapshot to the same content', async () => {
      const first = await open<ShieldedState>(fixture, (s) => ShieldedWallet(shieldedConfiguration()).tryRestore(s));
      const second = await open<ShieldedState>({ ...fixture, serialized: first.reserialized }, (s) =>
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
      const { state, reserialized } = await open<UnshieldedState>(fixture, (s) =>
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
      const { reserialized } = await open<UnshieldedState>(fixture, (s) =>
        UnshieldedWallet(unshieldedConfiguration()).tryRestore(s),
      );

      expect(declaredVersionOf(reserialized)).toBe(currentVersionOf.v1['unshielded']);
    });

    it('should open its own re-written snapshot to the same content', async () => {
      const first = await open<UnshieldedState>(fixture, (s) =>
        UnshieldedWallet(unshieldedConfiguration()).tryRestore(s),
      );
      const second = await open<UnshieldedState>({ ...fixture, serialized: first.reserialized }, (s) =>
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
      const { state } = await open<DustState>(fixture, (s) => DustWallet(dustConfiguration()).tryRestore(s));

      expect(project(fixture, dustValue(fixture, state))).toEqual(recorded(fixture));
    });

    it('should write the snapshot back at the version the variant it routed to owns', async () => {
      const { reserialized } = await open<DustState>(fixture, (s) => DustWallet(dustConfiguration()).tryRestore(s));

      expect(declaredVersionOf(reserialized)).toBe(currentVersionOf.v1['dust']);
    });

    it('should open its own re-written snapshot to the same content', async () => {
      const first = await open<DustState>(fixture, (s) => DustWallet(dustConfiguration()).tryRestore(s));
      const second = await open<DustState>({ ...fixture, serialized: first.reserialized }, (s) =>
        DustWallet(dustConfiguration()).tryRestore(s),
      );

      expect(project(fixture, dustValue(fixture, second.state))).toEqual(
        project(fixture, dustValue(fixture, first.state)),
      );
    });
  });
});
