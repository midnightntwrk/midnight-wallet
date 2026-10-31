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
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId as Networks,
  ProtocolVersion,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type CanAssign, type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { type Duration, Effect, Option } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  asV8DustParameters,
  asV9DustParameters,
  CustomForkingDustWallet,
  DustWallet,
  type DustWalletClass,
} from '../DustWallet.js';
import { type DefaultDustConfiguration, type DustWalletState } from '../DustWalletAPI.js';
import { type DustGenerationRates } from '../index.js';
import { CustomDustWallet } from '../SingleVariantDustWallet.js';
import { CoreWallet as V1CoreWallet } from '../v1/CoreWallet.js';
import { coreStateOf as v1CoreStateOf, V1Builder } from '../v1/index.js';
import { type WalletSyncUpdate as V1SyncUpdate } from '../v1/Sync.js';
import { type DefaultV1Configuration } from '../v1/V1Builder.js';
import {
  coreStateOf as v2CoreStateOf,
  Migration,
  TransactionHistory as V2TransactionHistory,
  V2Builder,
  V2Tag,
} from '../v2/index.js';
import { type NetworkId, type TotalCostParameters } from '../v2/types/index.js';
import { type WalletSyncUpdate as V2SyncUpdate } from '../v2/SyncSchema.js';
import { type DefaultV2Configuration } from '../v2/V2Builder.js';

describe('DefaultDustConfiguration', () => {
  it('is a configuration the package declares itself, not the head variant s', () => {
    type _1 = Expect<
      Equal<
        DefaultDustConfiguration,
        {
          networkId: NetworkId;
          costParameters: TotalCostParameters;
          dustParameters?: DustGenerationRates;
          txHistoryStorage: V2TransactionHistory.DustHistoryStorage;
          indexerClientConnection: { indexerHttpUrl: string };
          transactionDetailsRetryWindow?: Duration.DurationInput;
          forks: ProtocolVersion.ForkSchedule;
          chainVersionProbe?: ChainVersionProbe;
          skipLedgerV8DustHistory?: boolean;
        }
      >
    >;
  });

  it("builds either variant from everything but its dust rates, which become each ledger version's own parameters", () => {
    // One direction only, and deliberately so. The wallet's configuration now says something no single variant does —
    // where the boundary between them lies — so it is strictly larger than either variant's. What must keep holding is
    // that it can still build both: a variant asking for something this type does not carry would be a wallet that
    // cannot be built for one of its own variants.
    //
    // `dustParameters` is the one field not handed over as it is. The wallet is configured with plain rates, and each
    // variant is built with its own ledger version's `DustParameters` made from them: a ledger object belongs to the
    // WASM module that made it, so not even a structurally identical one could be shared.
    type WithoutRates = Omit<DefaultDustConfiguration, 'dustParameters'>;
    type _1 = Expect<CanAssign<WithoutRates, DefaultV2Configuration>>;
    type _2 = Expect<CanAssign<WithoutRates, DefaultV1Configuration>>;

    // Either ledger version's own parameters still configure the rates, so a caller already holding one can go on
    // passing it.
    type _7 = Expect<CanAssign<ledgerV9.DustParameters, DustGenerationRates>>;
    type _8 = Expect<CanAssign<ledgerV8.DustParameters, DustGenerationRates>>;

    // `forks` is the wallet layer's alone: neither variant knows there is another one.
    type _3 = Expect<Equal<'forks' extends keyof DefaultV1Configuration ? true : false, false>>;
    type _4 = Expect<Equal<'forks' extends keyof DefaultV2Configuration ? true : false, false>>;

    // And so is the question of where to start, for the same reason: a variant that does not know there is another
    // one has no use for the answer.
    type _5 = Expect<Equal<'chainVersionProbe' extends keyof DefaultV1Configuration ? true : false, false>>;
    type _6 = Expect<Equal<'chainVersionProbe' extends keyof DefaultV2Configuration ? true : false, false>>;
  });
});

describe('CustomForkingDustWallet', () => {
  it('composes a V2 variant built from a configuration of its own, which need not state dust parameters', () => {
    // A builder implementing `VariantBuilder` is configured with whatever it asks for, and may build its cross-ledger
    // migration on dust parameters it supplies itself; the wallet layer only hands each builder its configuration.
    type _1 = typeof CustomForkingDustWallet<V1SyncUpdate, V2SyncUpdate, object, { endpoint: string }>;
  });
});

describe('a dust wallet configured with dust rates', () => {
  const networkId = Networks.NetworkId.Undeployed;
  const v9 = ProtocolVersion.ProtocolVersion(7n);
  // Deliberately not the ledger's initial parameters, so a wallet that fell back to those is told apart.
  const rates: DustGenerationRates = {
    nightDustRatio: 4_000_000_000n,
    generationDecayRate: 9_000n,
    dustGracePeriodSeconds: 7_200n,
  };

  it('values a wallet crossing forks.v9 against rates configured as plain numbers, so configuring them imports no ledger', async () => {
    const Wallet = DustWallet({
      networkId,
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(V2TransactionHistory.DustTransactionHistoryEntrySchema),
      costParameters: { feeBlocksMargin: 0 },
      forks: { v9 },
      dustParameters: rates,
    });
    // The variant registered at forks.v9, which a wallet below the boundary hands over to.
    const { variant } = Wallet.allVariantsRecord()[V2Tag];
    const belowBoundary = V1CoreWallet.initEmpty(
      asV8DustParameters(rates),
      ledgerV8.DustSecretKey.fromSeed(Buffer.alloc(32, 1)),
      networkId,
    );

    const crossed = await Effect.runPromise(variant.migrateState(belowBoundary));

    const { nightDustRatio, generationDecayRate, dustGracePeriodSeconds } = crossed.state.params;
    expect(crossed.state.params).toBeInstanceOf(ledgerV9.DustParameters);
    expect({ nightDustRatio, generationDecayRate, dustGracePeriodSeconds }).toEqual(rates);
  });

  /** The three rates an empty state was valued against, whichever ledger version's object holds them. */
  const ratesOf = ({ nightDustRatio, generationDecayRate, dustGracePeriodSeconds }: DustGenerationRates) => ({
    nightDustRatio,
    generationDecayRate,
    dustGracePeriodSeconds,
  });

  /** The wallet's configuration, with the given way of asking the chain where it is. */
  const configuredWith = (chainVersionProbe: ChainVersionProbe): DefaultDustConfiguration => ({
    networkId,
    indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(V2TransactionHistory.DustTransactionHistoryEntrySchema),
    costParameters: { feeBlocksMargin: 0 },
    forks: { v9 },
    dustParameters: rates,
    chainVersionProbe,
  });

  /** A chain that answers it is at `version`, so a start picks its variant without reaching an indexer. */
  const chainAt =
    (version: ProtocolVersion.ProtocolVersion): ChainVersionProbe =>
    () =>
      Promise.resolve(version);

  /** A chain that cannot be reached, so a start begins on the V1 variant, as a wallet that never asked does. */
  const unreachableChain: ChainVersionProbe = () => Promise.reject(new Error('the indexer cannot be reached'));

  const seed = Buffer.alloc(32, 1);

  type StartableWallet = Pick<DustWalletClass, 'startWithSeed' | 'startWithKeys'>;
  type Started = Awaited<ReturnType<DustWalletClass['startWithSeed']>>;

  /** Each class-level start, given the rates it names, if any. */
  const starts: Record<
    'seed' | 'keys',
    (Wallet: StartableWallet, dustParameters?: DustGenerationRates) => Promise<Started>
  > = {
    seed: (Wallet, dustParameters) => Wallet.startWithSeed(seed, dustParameters),
    keys: (Wallet, dustParameters) =>
      Wallet.startWithKeys(
        { v8: ledgerV8.DustSecretKey.fromSeed(seed), v9: ledgerV9.DustSecretKey.fromSeed(seed) },
        dustParameters,
      ),
  };

  type RatesIn = (state: DustWalletState) => DustGenerationRates;
  const v1RatesIn: RatesIn = (state) => Option.getOrThrow(v1CoreStateOf(state)).state.params;
  const v2RatesIn: RatesIn = (state) => Option.getOrThrow(v2CoreStateOf(state)).state.params;

  /** The rates the state a wallet starts in is valued against, read before any sync could revalue it. */
  const startingRates = async (
    wallet: Readonly<{ state: rx.Observable<DustWalletState>; stop: () => Promise<void> }>,
    ratesIn: RatesIn,
  ): Promise<DustGenerationRates> => {
    const started = await rx.firstValueFrom(wallet.state);
    await wallet.stop();
    return ratesOf(ratesIn(started));
  };

  describe.each(['seed', 'keys'] as const)('a start from %s', (start) => {
    it.each<[string, string, ChainVersionProbe, RatesIn]>([
      ['V1', 'below forks.v9', chainAt(ProtocolVersion.MinSupportedVersion), v1RatesIn],
      ['V2', 'past forks.v9', chainAt(v9), v2RatesIn],
      ['V1', 'that cannot be reached', unreachableChain, v1RatesIn],
    ])(
      'values the %s variant it starts on, on a chain %s, against the configured rates when it names none',
      async (_variant, _chain, chainVersionProbe, ratesIn) => {
        const wallet = await starts[start](DustWallet(configuredWith(chainVersionProbe)));

        expect(await startingRates(wallet, ratesIn)).toEqual(rates);
      },
    );

    it('values a CustomForkingDustWallet composition against the rates its configuration names, when the start names none', async () => {
      // Composed as `DustWallet` composes itself, and as the testkit's and the e2e suites' compositions do: the wallet
      // layer is configured with the rates, and each variant with its own ledger version's parameters made from them.
      const Wallet = CustomForkingDustWallet(
        { networkId, forks: { v9 }, chainVersionProbe: chainAt(v9), dustParameters: rates },
        {
          builder: new V1Builder().withDefaults(),
          configuration: { ...configuredWith(chainAt(v9)), dustParameters: asV8DustParameters(rates) },
        },
        {
          builder: new V2Builder()
            .withDefaults()
            .withMigration(() => Migration.makeCrossLedgerMigration({ dustParameters: asV9DustParameters(rates) })),
          configuration: { ...configuredWith(chainAt(v9)), dustParameters: asV9DustParameters(rates) },
        },
      );

      expect(await startingRates(await starts[start](Wallet), v2RatesIn)).toEqual(rates);
    });

    it('values the wallet against the rates it names, over the configured ones', async () => {
      const named: DustGenerationRates = { ...rates, generationDecayRate: rates.generationDecayRate * 2n };

      const wallet = await starts[start](DustWallet(configuredWith(chainAt(v9))), named);

      expect(await startingRates(wallet, v2RatesIn)).toEqual(named);
    });
  });

  describe('built as the single-variant CustomDustWallet', () => {
    /** Configured as a single-variant composition is: with the V2 variant's own ledger-v9 parameters. */
    const Wallet = () =>
      CustomDustWallet(
        {
          networkId,
          indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
          txHistoryStorage: new InMemoryTransactionHistoryStorage(
            V2TransactionHistory.DustTransactionHistoryEntrySchema,
          ),
          costParameters: { feeBlocksMargin: 0 },
          dustParameters: asV9DustParameters(rates),
        },
        new V2Builder().withDefaults(),
      );

    /** Each class-level start, given the parameters it names, if any. */
    const singleVariantStarts: Record<
      'seed' | 'secret key',
      (dustParameters?: ledgerV9.DustParameters) => ReturnType<ReturnType<typeof Wallet>['startWithSeed']>
    > = {
      seed: (dustParameters) => Wallet().startWithSeed(seed, dustParameters),
      'secret key': (dustParameters) =>
        Wallet().startWithSecretKey(ledgerV9.DustSecretKey.fromSeed(seed), dustParameters),
    };

    it.each(['seed', 'secret key'] as const)(
      'values a start from a %s against the configured dust parameters when it names none',
      async (start) => {
        expect(await startingRates(singleVariantStarts[start](), v2RatesIn)).toEqual(rates);
      },
    );

    it.each(['seed', 'secret key'] as const)(
      'values a start from a %s against the dust parameters it names, over the configured ones',
      async (start) => {
        const named: DustGenerationRates = { ...rates, generationDecayRate: rates.generationDecayRate * 2n };

        expect(await startingRates(singleVariantStarts[start](asV9DustParameters(named)), v2RatesIn)).toEqual(named);
      },
    );
  });
});
