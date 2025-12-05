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
  makeDefaultTransactionHistoryCapability,
  TransactionHistoryCapability,
  DefaultTransactionHistoryConfiguration,
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

export type V1Variant<TSerialized, TSyncUpdate, TTransaction> = Variant.Variant<
  typeof V1Tag,
  CoreWallet,
  null,
  RunningV1Variant<TSerialized, TSyncUpdate, TTransaction>
> & {
  deserializeState: (serialized: TSerialized) => Either.Either<CoreWallet, WalletError>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
  serialization: SerializationCapability<CoreWallet, TSerialized>;
  transactionHistory: TransactionHistoryCapability<UnshieldedUpdate>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyV1Variant = V1Variant<any, any, any>;
export type DefaultV1Variant = V1Variant<
  string,
  WalletSyncUpdate,
  ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>
>;

export type TransactionOf<T extends AnyV1Variant> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends V1Variant<any, any, infer TTransaction> ? TTransaction : never;

export type SerializedStateOf<T extends AnyV1Variant> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends V1Variant<infer TSerialized, any, any> ? TSerialized : never;

export type DefaultV1Builder = V1Builder<
  DefaultV1Configuration,
  RunningV1Variant.Context<
    string,
    WalletSyncUpdate,
    ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>
  >,
  string,
  WalletSyncUpdate,
  ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>
>;

export class V1Builder<
  TConfig extends BaseV1Configuration = BaseV1Configuration,
  TContext extends Partial<RunningV1Variant.AnyContext> = object,
  TSerialized = never,
  TSyncUpdate = never,
  TTransaction = never,
> implements VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction>, TConfig>
{
  readonly #buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction>;

  constructor(buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> = {}) {
    this.#buildState = buildState;
  }

  withDefaults(): DefaultV1Builder {
    return this.withDefaultTransactionType()
      .withSyncDefaults()
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withTransactionHistoryDefaults()
      .withKeysDefaults()
      .withCoinSelectionDefaults() as DefaultV1Builder;
  }

  withTransactionType<Transaction>(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, Transaction> {
    return new V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, Transaction>({
      ...this.#buildState,
      transactingCapability: undefined,
      transactionHistoryCapability: undefined,
    });
  }

  withDefaultTransactionType(): V1Builder<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>
  > {
    return this.withTransactionType<ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>>();
  }

  withSyncDefaults(): V1Builder<
    TConfig & DefaultSyncConfiguration,
    TContext & DefaultSyncContext,
    TSerialized,
    WalletSyncUpdate,
    TTransaction
  > {
    return this.withSync(makeDefaultSyncService, makeDefaultSyncCapability);
  }

  withSync<TSyncConfig, TSyncContext extends Partial<RunningV1Variant.AnyContext>, TSyncUpdate>(
    syncService: (configuration: TSyncConfig, getContext: () => TSyncContext) => SyncService<CoreWallet, TSyncUpdate>,
    syncCapability: (
      configuration: TSyncConfig,
      getContext: () => TSyncContext,
    ) => SyncCapability<CoreWallet, TSyncUpdate>,
  ): V1Builder<TConfig & TSyncConfig, TContext & TSyncContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TSyncConfig, TContext & TSyncContext, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      syncService,
      syncCapability,
    });
  }

  withSerializationDefaults(): V1Builder<TConfig, TContext, string, TSyncUpdate, TTransaction> {
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
  ): V1Builder<
    TConfig & TSerializationConfig,
    TContext & TSerializationContext,
    TSerialized,
    TSyncUpdate,
    TTransaction
  > {
    return new V1Builder<
      TConfig & TSerializationConfig,
      TContext & TSerializationContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      serializationCapability,
    });
  }

  withTransactingDefaults(
    this: V1Builder<
      TConfig,
      TContext,
      TSerialized,
      TSyncUpdate,
      ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>
    >,
  ): V1Builder<
    TConfig & DefaultTransactingConfiguration,
    TContext & DefaultTransactingContext,
    TSerialized,
    TSyncUpdate,
    ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>
  > {
    return this.withTransacting(makeDefaultTransactingCapability);
  }

  withTransacting<TTransactingConfig, TTransactingContext extends Partial<RunningV1Variant.AnyContext>>(
    transactingCapability: (
      config: TTransactingConfig,
      getContext: () => TTransactingContext,
    ) => TransactingCapability<TTransaction, CoreWallet>,
  ): V1Builder<TConfig & TTransactingConfig, TContext & TTransactingContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<
      TConfig & TTransactingConfig,
      TContext & TTransactingContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      transactingCapability,
    });
  }

  withCoinSelection<TCoinSelectionConfig, TCoinSelectionContext extends Partial<RunningV1Variant.AnyContext>>(
    coinSelection: (
      config: TCoinSelectionConfig,
      getContext: () => TCoinSelectionContext,
    ) => CoinSelection<ledger.Utxo>,
  ): V1Builder<
    TConfig & TCoinSelectionConfig,
    TContext & TCoinSelectionContext,
    TSerialized,
    TSyncUpdate,
    TTransaction
  > {
    return new V1Builder<
      TConfig & TCoinSelectionConfig,
      TContext & TCoinSelectionContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      coinSelection,
    });
  }

  withCoinSelectionDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> {
    return this.withCoinSelection(() => chooseCoin);
  }

  withCoinsAndBalancesDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> {
    return this.withCoinsAndBalances(makeDefaultCoinsAndBalancesCapability);
  }

  withCoinsAndBalances<TBalancesConfig, TBalancesContext extends Partial<RunningV1Variant.AnyContext>>(
    coinsAndBalancesCapability: (
      configuration: TBalancesConfig,
      getContext: () => TBalancesContext,
    ) => CoinsAndBalancesCapability<CoreWallet>,
  ): V1Builder<TConfig & TBalancesConfig, TContext & TBalancesContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<
      TConfig & TBalancesConfig,
      TContext & TBalancesContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      coinsAndBalancesCapability,
    });
  }

  withTransactionHistoryDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, ledger.FinalizedTransaction>,
  ): V1Builder<
    TConfig & DefaultTransactionHistoryConfiguration,
    TContext,
    TSerialized,
    TSyncUpdate,
    ledger.FinalizedTransaction
  > {
    return this.withTransactionHistory(makeDefaultTransactionHistoryCapability);
  }

  withTransactionHistory<
    TTransactionHistoryConfig,
    TTransactionHistoryContext extends Partial<RunningV1Variant.AnyContext>,
  >(
    transactionHistoryCapability: (
      configuration: TTransactionHistoryConfig,
      getContext: () => TTransactionHistoryContext,
    ) => TransactionHistoryCapability<UnshieldedUpdate>,
  ): V1Builder<
    TConfig & TTransactionHistoryConfig,
    TContext & TTransactionHistoryContext,
    TSerialized,
    TSyncUpdate,
    TTransaction
  > {
    return new V1Builder<
      TConfig & TTransactionHistoryConfig,
      TContext & TTransactionHistoryContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      transactionHistoryCapability,
    });
  }

  withKeysDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> {
    return this.withKeys(makeDefaultKeysCapability);
  }

  withKeys<TKeysConfig, TKeysContext extends Partial<RunningV1Variant.AnyContext>>(
    keysCapability: (configuration: TKeysConfig, getContext: () => TKeysContext) => KeysCapability<CoreWallet>,
  ): V1Builder<TConfig & TKeysConfig, TContext & TKeysContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TKeysConfig, TContext & TKeysContext, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      keysCapability,
    });
  }

  build(
    this: V1Builder<
      TConfig,
      RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction>,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >,
    configuration: TConfig,
  ): V1Variant<TSerialized, TSyncUpdate, TTransaction> {
    const v1Context = this.#buildContextFromBuildState(configuration);
    const { networkId } = configuration;

    return {
      __polyTag__: V1Tag,
      coinsAndBalances: v1Context.coinsAndBalancesCapability,
      keys: v1Context.keysCapability,
      serialization: v1Context.serializationCapability,
      transactionHistory: v1Context.transactionHistoryCapability,
      start(
        context: Variant.VariantContext<CoreWallet>,
      ): Effect.Effect<RunningV1Variant<TSerialized, TSyncUpdate, TTransaction>, WalletRuntimeError, Scope.Scope> {
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
    this: V1Builder<
      TConfig,
      RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction>,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >,
    configuration: TConfig,
  ): RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction> {
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
      transactionHistoryCapability,
    } = this.#buildState;

    const getContext = (): RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction> => context;

    const context = {
      serializationCapability: serializationCapability(configuration, getContext),
      syncCapability: syncCapability(configuration, getContext),
      syncService: syncService(configuration, getContext),
      transactingCapability: transactingCapability(configuration, getContext),
      coinsAndBalancesCapability: coinsAndBalancesCapability(configuration, getContext),
      keysCapability: keysCapability(configuration, getContext),
      coinSelection: coinSelection(configuration, getContext),
      transactionHistoryCapability: transactionHistoryCapability(configuration, getContext),
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

  type HasTransacting<TConfig, TContext, TTransaction> = {
    readonly transactingCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => TransactingCapability<TTransaction, CoreWallet>;
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
    readonly transactionHistoryCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => TransactionHistoryCapability<UnshieldedUpdate>;
  };

  type HasKeys<TConfig, TContext> = {
    readonly keysCapability: (configuration: TConfig, getContext: () => TContext) => KeysCapability<CoreWallet>;
  };

  /**
   * The internal build state of {@link V1Builder}.
   */
  type FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> = Types.Simplify<
    HasSync<TConfig, TContext, TSyncUpdate> &
      HasSerialization<TConfig, TContext, TSerialized> &
      HasTransacting<TConfig, TContext, TTransaction> &
      HasCoinSelection<TConfig, TContext> &
      HasCoinsAndBalances<TConfig, TContext> &
      HasKeys<TConfig, TContext> &
      HasTransactionHistory<TConfig, TContext>
  >;
  type PartialBuildState<
    TConfig = object,
    TContext = object,
    TSerialized = never,
    TSyncUpdate = never,
    TTransaction = never,
  > = {
    [K in keyof FullBuildState<never, never, never, never, never>]?:
      | FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction>[K]
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

const isBuildStateFull = <TConfig, TContext, TSerialized, TSyncUpdate, TTransaction>(
  buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction>,
): buildState is V1Builder.FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> => {
  const allBuildStateKeys = [
    'syncService',
    'syncCapability',
    'transactingCapability',
    'coinSelection',
    'serializationCapability',
    'coinsAndBalancesCapability',
    'keysCapability',
    'transactionHistoryCapability',
  ] as const;
  /**
   * This type will fail compilation if any key is omitted, letting the `isFull` check work properly
   */
  type _1 = Expect<
    Equal<keyof V1Builder.FullBuildState<never, never, never, never, never>, ItemType<typeof allBuildStateKeys>>
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
