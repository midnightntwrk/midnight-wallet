// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Effect, Either, Scope, Types } from 'effect';
import { WalletSeed, NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Variant, VariantBuilder, WalletRuntimeError } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { RunningV1Variant, V1Tag } from './RunningV1Variant.js';
import { makeDefaultV1SerializationCapability, SerializationCapability } from './Serialization.js';
import {
  DefaultSyncContext,
  DefaultSyncConfiguration,
  SyncCapability,
  SyncService,
  makeDefaultSyncService,
  makeDefaultSyncCapability,
} from './Sync.js';
import { WalletSyncUpdate, UnshieldedUpdate } from './SyncSchema.js';
import {
  DefaultTransactingConfiguration,
  DefaultTransactingContext,
  makeDefaultTransactingCapability,
  TransactingCapability,
} from './Transacting.js';
import { WalletError } from './WalletError.js';
import { CoinsAndBalancesCapability, makeDefaultCoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { KeysCapability, makeDefaultKeysCapability } from './Keys.js';
import { CoinSelection, chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { CoreWallet } from './CoreWallet.js';
import {
  DefaultTransactionHistoryConfiguration,
  TransactionHistoryService,
  makeDefaultTransactionHistoryService,
} from './TransactionHistory.js';
import { Expect, Equal, ItemType } from '@midnight-ntwrk/wallet-sdk-utilities/types';
import { createKeystore, PublicKey } from '../KeyStore.js';

export type BaseV1Configuration = {
  networkId: NetworkId.NetworkId;
};

export type DefaultV1Configuration = BaseV1Configuration &
  DefaultSyncConfiguration &
  DefaultTransactingConfiguration &
  DefaultTransactionHistoryConfiguration;

const V1BuilderSymbol: {
  readonly typeId: unique symbol;
} = {
  typeId: Symbol('@midnight-ntwrk/unshielded-wallet#V1Builder') as (typeof V1BuilderSymbol)['typeId'],
} as const;

export type V1Variant<TSerialized, TSyncUpdate> = Variant.Variant<
  typeof V1Tag,
  CoreWallet,
  null,
  RunningV1Variant<TSerialized, TSyncUpdate>
> & {
  deserializeState: (serialized: TSerialized) => Either.Either<CoreWallet, WalletError>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
  serialization: SerializationCapability<CoreWallet, TSerialized>;
  transactionHistory: TransactionHistoryService<UnshieldedUpdate>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyV1Variant = V1Variant<any, any>;
export type DefaultV1Variant = V1Variant<string, WalletSyncUpdate>;

export type TransactionOf<T extends AnyV1Variant> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends V1Variant<any, any>
    ? ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>
    : never;

export type SerializedStateOf<T extends AnyV1Variant> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends V1Variant<infer TSerialized, any> ? TSerialized : never;

export type DefaultV1Builder = V1Builder<
  DefaultV1Configuration,
  RunningV1Variant.Context<string, WalletSyncUpdate>,
  string,
  WalletSyncUpdate
>;

export class V1Builder<
  TConfig extends BaseV1Configuration = BaseV1Configuration,
  TContext extends Partial<RunningV1Variant.AnyContext> = object,
  TSerialized = never,
  TSyncUpdate = never,
> implements VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate>, TConfig> {
  readonly #buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate>;

  constructor(buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate> = {}) {
    this.#buildState = buildState;
  }

  withDefaults(): DefaultV1Builder {
    return this.withSyncDefaults()
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withTransactionHistoryDefaults()
      .withKeysDefaults()
      .withCoinSelectionDefaults() as DefaultV1Builder;
  }

  withSyncDefaults(): V1Builder<
    TConfig & DefaultSyncConfiguration,
    TContext & DefaultSyncContext,
    TSerialized,
    WalletSyncUpdate
  > {
    return this.withSync(makeDefaultSyncService, makeDefaultSyncCapability);
  }

  withSync<TSyncConfig, TSyncContext extends Partial<RunningV1Variant.AnyContext>, TSyncUpdate>(
    syncService: (configuration: TSyncConfig, getContext: () => TSyncContext) => SyncService<CoreWallet, TSyncUpdate>,
    syncCapability: (
      configuration: TSyncConfig,
      getContext: () => TSyncContext,
    ) => SyncCapability<CoreWallet, TSyncUpdate>,
  ): V1Builder<TConfig & TSyncConfig, TContext & TSyncContext, TSerialized, TSyncUpdate> {
    return new V1Builder<TConfig & TSyncConfig, TContext & TSyncContext, TSerialized, TSyncUpdate>({
      ...this.#buildState,
      syncService,
      syncCapability,
    });
  }

  withSerializationDefaults(): V1Builder<TConfig, TContext, string, TSyncUpdate> {
    return this.withSerialization(makeDefaultV1SerializationCapability);
  }

  withSerialization<
    TSerializationConfig,
    TSerializationContext extends Partial<RunningV1Variant.AnyContext>,
    TSerialized,
  >(
    serializationCapability: (
      configuration: TSerializationConfig,
      getContext: () => TSerializationContext,
    ) => SerializationCapability<CoreWallet, TSerialized>,
  ): V1Builder<TConfig & TSerializationConfig, TContext & TSerializationContext, TSerialized, TSyncUpdate> {
    return new V1Builder<TConfig & TSerializationConfig, TContext & TSerializationContext, TSerialized, TSyncUpdate>({
      ...this.#buildState,
      serializationCapability,
    });
  }

  withTransactingDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate>,
  ): V1Builder<
    TConfig & DefaultTransactingConfiguration,
    TContext & DefaultTransactingContext,
    TSerialized,
    TSyncUpdate
  > {
    return this.withTransacting(makeDefaultTransactingCapability);
  }

  withTransacting<TTransactingConfig, TTransactingContext extends Partial<RunningV1Variant.AnyContext>>(
    transactingCapability: (
      config: TTransactingConfig,
      getContext: () => TTransactingContext,
    ) => TransactingCapability<CoreWallet>,
  ): V1Builder<TConfig & TTransactingConfig, TContext & TTransactingContext, TSerialized, TSyncUpdate> {
    return new V1Builder<TConfig & TTransactingConfig, TContext & TTransactingContext, TSerialized, TSyncUpdate>({
      ...this.#buildState,
      transactingCapability,
    });
  }

  withCoinSelection<TCoinSelectionConfig, TCoinSelectionContext extends Partial<RunningV1Variant.AnyContext>>(
    coinSelection: (
      config: TCoinSelectionConfig,
      getContext: () => TCoinSelectionContext,
    ) => CoinSelection<ledger.Utxo>,
  ): V1Builder<TConfig & TCoinSelectionConfig, TContext & TCoinSelectionContext, TSerialized, TSyncUpdate> {
    return new V1Builder<TConfig & TCoinSelectionConfig, TContext & TCoinSelectionContext, TSerialized, TSyncUpdate>({
      ...this.#buildState,
      coinSelection,
    });
  }

  withCoinSelectionDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate> {
    return this.withCoinSelection(() => chooseCoin);
  }

  withCoinsAndBalancesDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate> {
    return this.withCoinsAndBalances(makeDefaultCoinsAndBalancesCapability);
  }

  withCoinsAndBalances<TBalancesConfig, TBalancesContext extends Partial<RunningV1Variant.AnyContext>>(
    coinsAndBalancesCapability: (
      configuration: TBalancesConfig,
      getContext: () => TBalancesContext,
    ) => CoinsAndBalancesCapability<CoreWallet>,
  ): V1Builder<TConfig & TBalancesConfig, TContext & TBalancesContext, TSerialized, TSyncUpdate> {
    return new V1Builder<TConfig & TBalancesConfig, TContext & TBalancesContext, TSerialized, TSyncUpdate>({
      ...this.#buildState,
      coinsAndBalancesCapability,
    });
  }

  withTransactionHistoryDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate>,
  ): V1Builder<TConfig & DefaultTransactionHistoryConfiguration, TContext, TSerialized, TSyncUpdate> {
    return this.withTransactionHistory(makeDefaultTransactionHistoryService);
  }

  withTransactionHistory<
    TTransactionHistoryConfig,
    TTransactionHistoryContext extends Partial<RunningV1Variant.AnyContext>,
  >(
    transactionHistoryService: (
      configuration: TTransactionHistoryConfig,
      getContext: () => TTransactionHistoryContext,
    ) => TransactionHistoryService<UnshieldedUpdate>,
  ): V1Builder<TConfig & TTransactionHistoryConfig, TContext & TTransactionHistoryContext, TSerialized, TSyncUpdate> {
    return new V1Builder<
      TConfig & TTransactionHistoryConfig,
      TContext & TTransactionHistoryContext,
      TSerialized,
      TSyncUpdate
    >({
      ...this.#buildState,
      transactionHistoryService,
    });
  }

  withKeysDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate> {
    return this.withKeys(makeDefaultKeysCapability);
  }

  withKeys<TKeysConfig, TKeysContext extends Partial<RunningV1Variant.AnyContext>>(
    keysCapability: (configuration: TKeysConfig, getContext: () => TKeysContext) => KeysCapability<CoreWallet>,
  ): V1Builder<TConfig & TKeysConfig, TContext & TKeysContext, TSerialized, TSyncUpdate> {
    return new V1Builder<TConfig & TKeysConfig, TContext & TKeysContext, TSerialized, TSyncUpdate>({
      ...this.#buildState,
      keysCapability,
    });
  }

  build(
    this: V1Builder<TConfig, RunningV1Variant.Context<TSerialized, TSyncUpdate>, TSerialized, TSyncUpdate>,
    configuration: TConfig,
  ): V1Variant<TSerialized, TSyncUpdate> {
    const v1Context = this.#buildContextFromBuildState(configuration);
    const { networkId } = configuration;

    return {
      __polyTag__: V1Tag,
      coinsAndBalances: v1Context.coinsAndBalancesCapability,
      keys: v1Context.keysCapability,
      serialization: v1Context.serializationCapability,
      transactionHistory: v1Context.transactionHistoryService,
      start(
        context: Variant.VariantContext<CoreWallet>,
      ): Effect.Effect<RunningV1Variant<TSerialized, TSyncUpdate>, WalletRuntimeError, Scope.Scope> {
        return Effect.gen(function* () {
          const scope = yield* Scope.Scope;
          return new RunningV1Variant(scope, context, v1Context);
        });
      },
      migrateState(_previousState) {
        const seed = WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001');

        return Effect.succeed(CoreWallet.init(PublicKey.fromKeyStore(createKeystore(seed, networkId)), networkId));
      },

      deserializeState: (serialized: TSerialized): Either.Either<CoreWallet, WalletError> => {
        return v1Context.serializationCapability.deserialize(serialized);
      },
    };
  }

  #buildContextFromBuildState(
    this: V1Builder<TConfig, RunningV1Variant.Context<TSerialized, TSyncUpdate>, TSerialized, TSyncUpdate>,
    configuration: TConfig,
  ): RunningV1Variant.Context<TSerialized, TSyncUpdate> {
    if (!isBuildStateFull(this.#buildState)) {
      throw new Error('Not all components are configured in V1 Builder');
    }

    const {
      syncCapability,
      syncService,
      transactingCapability,
      serializationCapability,
      coinSelection,
      coinsAndBalancesCapability,
      keysCapability,
      transactionHistoryService,
    } = this.#buildState;

    const getContext = (): RunningV1Variant.Context<TSerialized, TSyncUpdate> => context;

    const context = {
      serializationCapability: serializationCapability(configuration, getContext),
      syncCapability: syncCapability(configuration, getContext),
      syncService: syncService(configuration, getContext),
      transactingCapability: transactingCapability(configuration, getContext),
      coinsAndBalancesCapability: coinsAndBalancesCapability(configuration, getContext),
      keysCapability: keysCapability(configuration, getContext),
      coinSelection: coinSelection(configuration, getContext),
      transactionHistoryService: transactionHistoryService(configuration, getContext),
    };

    return context;
  }
}

/** @internal */
declare namespace V1Builder {
  type HasSync<TConfig, TContext, TSyncUpdate> = {
    readonly syncService: (configuration: TConfig, getContext: () => TContext) => SyncService<CoreWallet, TSyncUpdate>;
    readonly syncCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => SyncCapability<CoreWallet, TSyncUpdate>;
  };

  type HasTransacting<TConfig, TContext> = {
    readonly transactingCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => TransactingCapability<CoreWallet>;
  };

  type HasCoinSelection<TConfig, TContext> = {
    readonly coinSelection: (configuration: TConfig, getContext: () => TContext) => CoinSelection<ledger.Utxo>;
  };

  type HasSerialization<TConfig, TContext, TSerialized> = {
    readonly serializationCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => SerializationCapability<CoreWallet, TSerialized>;
  };

  type HasCoinsAndBalances<TConfig, TContext> = {
    readonly coinsAndBalancesCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => CoinsAndBalancesCapability<CoreWallet>;
  };

  type HasTransactionHistory<TConfig, TContext> = {
    readonly transactionHistoryService: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => TransactionHistoryService<UnshieldedUpdate>;
  };

  type HasKeys<TConfig, TContext> = {
    readonly keysCapability: (configuration: TConfig, getContext: () => TContext) => KeysCapability<CoreWallet>;
  };

  /**
   * The internal build state of {@link V1Builder}.
   */
  type FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate> = Types.Simplify<
    HasSync<TConfig, TContext, TSyncUpdate> &
      HasSerialization<TConfig, TContext, TSerialized> &
      HasTransacting<TConfig, TContext> &
      HasCoinSelection<TConfig, TContext> &
      HasCoinsAndBalances<TConfig, TContext> &
      HasKeys<TConfig, TContext> &
      HasTransactionHistory<TConfig, TContext>
  >;
  type PartialBuildState<TConfig = object, TContext = object, TSerialized = never, TSyncUpdate = never> = {
    [K in keyof FullBuildState<never, never, never, never>]?:
      | FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate>[K]
      | undefined;
  };

  /**
   * Utility interface that manages the type variance of {@link V1Builder}.
   */
  interface Variance<R> {
    readonly [V1BuilderSymbol.typeId]: {
      readonly _R: Types.Covariant<R>;
    };
  }
}

const isBuildStateFull = <TConfig, TContext, TSerialized, TSyncUpdate>(
  buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate>,
): buildState is V1Builder.FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate> => {
  const allBuildStateKeys = [
    'syncService',
    'syncCapability',
    'transactingCapability',
    'coinSelection',
    'serializationCapability',
    'coinsAndBalancesCapability',
    'keysCapability',
    'transactionHistoryService',
  ] as const;
  /**
   * This type will fail compilation if any key is omitted, letting the `isFull` check work properly
   */
  type _1 = Expect<
    Equal<keyof V1Builder.FullBuildState<never, never, never, never>, ItemType<typeof allBuildStateKeys>>
  >;
  return allBuildStateKeys.every((key) => typeof buildState[key] == 'function');
};

/** @internal */
declare namespace _V1BuilderMethods {
  type WithSyncDefaults = 'withSyncDefaults';
  type WithSyncMethod = 'withSync';
  type WithTransactingMethod = 'withTransacting';
  type WithTransactingDefaults = 'withTransactingDefaults';
  type WithSerializationMethod = 'withSerialization';
  type WithSerializationDefaults = 'withSerializationDefaults';
  type WithCoinsAndBalancesDefaults = 'withCoinsAndBalancesDefaults';
  type WithKeysDefaults = 'withKeysDefaults';
  type WithTransactionHistoryDefaults = 'withTransactionHistoryDefaults';
  type AllSyncMethods = WithSyncDefaults | WithSyncMethod;
  type AllTransactingMethods = WithTransactingMethod | WithTransactingDefaults;
  type AllSerializationMethods = WithSerializationMethod | WithSerializationDefaults;
  type AllCoinsAndBalancesMethods = 'withCoinsAndBalancesDefaults';
  type AllKeysMethods = 'withKeysDefaults';
  type AllTransactionHistoryMethods = 'withTransactionHistoryDefaults';
  type AllMethods =
    | AllSyncMethods
    | AllTransactingMethods
    | AllSerializationMethods
    | AllCoinsAndBalancesMethods
    | AllKeysMethods
    | AllTransactionHistoryMethods;
}
