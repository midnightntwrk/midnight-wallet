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
import { Either } from 'effect';
import { firstValueFrom, type Observable } from 'rxjs';
import { type Fixture } from './fixtures.js';

/**
 * Reading a restored wallet the way an application would, and projecting what it holds into the shape a frozen fixture
 * records.
 *
 * Shared by the two wallet-layer compatibility suites — the dual-variant build, where every frozen snapshot routes to
 * the variant that owns its protocol version, and the single-variant build, where only the V2 variant exists to open
 * them. One accessor map for both, so the two suites cannot come to disagree about what a recorded key means, and so a
 * key added to the corpus is owed an accessor once rather than twice.
 */

/**
 * What one fixture looks like once the wallet has opened it: the state the application would read, and the snapshot the
 * wallet writes back.
 */
export type Opened<TState> = {
  readonly state: TState;
  readonly reserialized: string;
};

/**
 * All three wallets, described by the three members this file uses.
 *
 * Structural rather than generic over the wallet type: the three are unrelated classes, and naming only what is read
 * here lets one helper serve all of them without a cast at each call site.
 */
export type WalletHandle = {
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
export const openWallet = async <TState>(
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
export const asStrings = (values: Iterable<bigint>): readonly string[] => [...values].map(String).sort();

/**
 * The one thing a frozen fixture records that no wallet API exposes.
 *
 * `backingNightValue` is the value of the Night UTxO backing a Dust generation, which lives inside the ledger's
 * `DustLocalState` and is not projected onto the wallet state. It is asserted at the capability level; naming it here
 * keeps the omission deliberate and visible rather than silent.
 */
const NOT_REACHABLE_THROUGH_THE_WALLET: ReadonlySet<string> = new Set(['backingNightValue']);

/** The recorded expectations this file is answerable for: everything the fixture states, minus the exclusion above. */
export const answerableKeys = (fixture: Fixture): readonly string[] =>
  Object.keys(fixture.expected)
    .filter((key) => !NOT_REACHABLE_THROUGH_THE_WALLET.has(key))
    .sort();

/** The fixture's own record, narrowed to the keys this file answers, for a whole-object comparison. */
export const recorded = (fixture: Fixture): Record<string, unknown> =>
  Object.fromEntries(answerableKeys(fixture).map((key) => [key, fixture.expected[key]]));

/**
 * Project the wallet's state into the same shape the fixture records.
 *
 * Whole-object rather than key-by-key on purpose: a key added to a fixture with no accessor here throws instead of
 * being quietly skipped, so the corpus cannot grow past what this file checks.
 */
export const project = (fixture: Fixture, value: (key: string) => unknown): Record<string, unknown> =>
  Object.fromEntries(answerableKeys(fixture).map((key) => [key, value(key)]));

export type ShieldedState = {
  readonly balances: Record<string, bigint>;
  readonly availableCoins: readonly { readonly coin: { readonly type: string; readonly value: bigint } }[];
  readonly state: {
    readonly networkId: string;
    // Type cast required because: the ledger's `ZswapLocalState` is not re-exported by this package, and `firstFree`
    // is the only member read here.
    readonly state: { readonly firstFree: bigint; readonly pendingSpends: ReadonlyMap<unknown, unknown> };
  };
};

export type UnshieldedState = {
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

export type DustState = {
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

export const shieldedValue =
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

export const unshieldedValue =
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

export const dustValue =
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
export const pairRegisteredFlags = (expectation: Record<string, unknown>): Record<string, unknown> =>
  'registeredFlags' in expectation
    ? {
        ...expectation,
        registeredFlags: (expectation['availableValues'] as readonly string[])
          .map((value, index) => `${value}:${(expectation['registeredFlags'] as readonly boolean[])[index]}`)
          .sort(),
      }
    : expectation;
