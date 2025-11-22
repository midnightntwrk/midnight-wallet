import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { BaseV1Configuration, DefaultV1Configuration, V1Builder, V1Tag, V1Variant, CoreWallet } from './v1/index.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Effect, Either, Scope } from 'effect';
import * as rx from 'rxjs';
import { ProvingRecipe } from './v1/ProvingRecipe.js';
import { SerializationCapability } from './v1/Serialization.js';
import { TransactionHistoryCapability } from './v1/TransactionHistory.js';
import { CoinsAndBalancesCapability } from './v1/CoinsAndBalances.js';
import { KeysCapability } from './v1/Keys.js';
import { TokenTransfer } from './v1/Transacting.js';
import { WalletSyncUpdate } from './v1/Sync.js';
import { Variant, VariantBuilder, WalletLike } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { Runtime, WalletBuilder } from '@midnight-ntwrk/wallet-sdk-runtime';
import { Utxo } from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import { PublicKeys } from './v1/KeyStore.js';
import { SyncProgress } from './v1/SyncProgress.js';
import { TransactionHistoryEntry } from './v1/storage/index.js';

export type UnshieldedWalletCapabilities<TSerialized = string, TTransaction = ledger.FinalizedTransaction> = {
  serialization: SerializationCapability<CoreWallet, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
  transactionHistory: TransactionHistoryCapability<TTransaction>;
};

export class UnshieldedWalletState<TSerialized = string, TTransaction = ledger.FinalizedTransaction> {
  static readonly mapState =
    <TSerialized = string, TTransaction = ledger.FinalizedTransaction>(
      capabilities: UnshieldedWalletCapabilities<TSerialized, TTransaction>,
    ) =>
    (state: ProtocolState.ProtocolState<CoreWallet>): UnshieldedWalletState<TSerialized, TTransaction> => {
      return new UnshieldedWalletState(state, capabilities);
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: CoreWallet;
  readonly capabilities: UnshieldedWalletCapabilities<TSerialized, TTransaction>;

  get balances(): Record<ledger.RawTokenType, bigint> {
    return this.capabilities.coinsAndBalances.getAvailableBalances(this.state);
  }

  get totalCoins(): readonly Utxo[] {
    return this.capabilities.coinsAndBalances.getTotalCoins(this.state);
  }

  get availableCoins(): readonly Utxo[] {
    return this.capabilities.coinsAndBalances.getAvailableCoins(this.state);
  }

  get pendingCoins(): readonly Utxo[] {
    return this.capabilities.coinsAndBalances.getPendingCoins(this.state);
  }

  get address(): ledger.UserAddress {
    return this.capabilities.keys.getAddress(this.state);
  }

  get progress(): SyncProgress {
    return this.state.progress;
  }

  get transactionHistory(): AsyncIterableIterator<TransactionHistoryEntry> {
    return this.capabilities.transactionHistory.getAll();
  }

  constructor(
    state: ProtocolState.ProtocolState<CoreWallet>,
    capabilities: UnshieldedWalletCapabilities<TSerialized, TTransaction>,
  ) {
    this.protocolVersion = state.version;
    this.state = state.state;
    this.capabilities = capabilities;
  }

  serialize(): TSerialized {
    return this.capabilities.serialization.serialize(this.state);
  }
}

export type UnshieldedWallet = CustomizedUnshieldedWallet<ledger.UnprovenTransaction, WalletSyncUpdate, string>;

export type UnshieldedWalletClass = CustomizedUnshieldedWalletClass<
  ledger.UnprovenTransaction,
  WalletSyncUpdate,
  string
>;

export interface CustomizedUnshieldedWallet<
  TTransaction = ledger.UnprovenTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
> extends WalletLike.WalletLike<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction>>]> {
  readonly state: rx.Observable<UnshieldedWalletState<TSerialized, TTransaction>>;

  start(): Promise<void>;

  // we can balance bound and unbound txs
  balanceTransaction(
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  ): Promise<ProvingRecipe<TTransaction>>;

  transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<ProvingRecipe<TTransaction>>;

  initSwap(
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
    ttl: Date,
  ): Promise<ProvingRecipe<TTransaction>>;

  // finalizeTransaction(recipe: ProvingRecipe<TTransaction>): Promise<TTransaction>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<UnshieldedWalletState<TSerialized, TTransaction>>;

  getAddress(): Promise<ledger.UserAddress>;
}

export interface CustomizedUnshieldedWalletClass<
  TTransaction = ledger.UnprovenTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
  TConfig extends BaseV1Configuration = DefaultV1Configuration,
> extends WalletLike.BaseWalletClass<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction>>]> {
  configuration: TConfig;
  startWithPublicKeys(publicKeys: PublicKeys): CustomizedUnshieldedWallet<TTransaction, TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedUnshieldedWallet<TTransaction, TSyncUpdate, TSerialized>;
}

export function UnshieldedWallet(configuration: DefaultV1Configuration): UnshieldedWalletClass {
  return CustomUnshieldedWallet(configuration, new V1Builder().withDefaults());
}

export function CustomUnshieldedWallet<
  TConfig extends BaseV1Configuration = DefaultV1Configuration,
  TTransaction = ledger.UnprovenTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction>, TConfig>,
): CustomizedUnshieldedWalletClass<TTransaction, TSyncUpdate, TSerialized, TConfig> {
  const buildArgs = [configuration] as WalletBuilder.BuildArguments<
    [
      VariantBuilder.VersionedVariantBuilder<
        VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction>, TConfig>
      >,
    ]
  >;
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, builder)
    .build(...buildArgs) as WalletLike.BaseWalletClass<
    [Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction>>],
    TConfig
  >;

  return class CustomUnshieldedWalletImplementation
    extends BaseWallet
    implements CustomizedUnshieldedWallet<TTransaction, TSyncUpdate, TSerialized>
  {
    static startWithPublicKeys(publicKeys: PublicKeys): CustomUnshieldedWalletImplementation {
      return CustomUnshieldedWalletImplementation.startFirst(
        CustomUnshieldedWalletImplementation,
        CoreWallet.init(publicKeys, configuration.networkId),
      );
    }

    static restore(serializedState: TSerialized): CustomUnshieldedWalletImplementation {
      const deserialized: CoreWallet = CustomUnshieldedWalletImplementation.allVariantsRecord()
        [V1Tag].variant.deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return CustomUnshieldedWalletImplementation.startFirst(CustomUnshieldedWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<UnshieldedWalletState<TSerialized, TTransaction>>;

    constructor(
      runtime: Runtime.Runtime<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction>>]>,
      scope: Scope.CloseableScope,
    ) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(
          UnshieldedWalletState.mapState<TSerialized, TTransaction>(
            CustomUnshieldedWalletImplementation.allVariantsRecord()[V1Tag].variant,
          ),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(): Promise<void> {
      return this.runtime.dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground() }).pipe(Effect.runPromise);
    }

    balanceTransaction(
      tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
    ): Promise<ProvingRecipe<TTransaction>> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.balanceTransaction(tx as TTransaction),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<ProvingRecipe<TTransaction>> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.transferTransaction(outputs, ttl),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
      ttl: Date,
    ): Promise<ProvingRecipe<TTransaction>> {
      return this.runtime
        .dispatch({ [V1Tag]: (v1) => v1.initSwap(desiredInputs, desiredOutputs, ttl) })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<UnshieldedWalletState<TSerialized, TTransaction>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state
     * It's preferable to use [[UnshieldedWalletState.serialize]] instead, to know exactly, which state is serialized
     */
    serializeState(): Promise<TSerialized> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<ledger.UserAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}
