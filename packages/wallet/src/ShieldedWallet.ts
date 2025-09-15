import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { WalletBuilder } from './WalletBuilder';
import { DefaultV1Configuration, DefaultV1Variant, V1Builder, V1State, V1Tag } from './v1';
import * as ledger from '@midnight-ntwrk/ledger';
import { Effect, Either, Scope } from 'effect';
import * as rx from 'rxjs';
import { Runtime } from './Runtime';
import { VersionedVariant } from './abstractions/Variant';
import { WalletLike } from './abstractions';
import { ProvingRecipe } from './v1/ProvingRecipe';
import { SerializationCapability } from './v1/Serialization';
import { ProgressUpdate, TransactionHistoryCapability } from './v1/TransactionHistory';
import { AvailableCoin, CoinsAndBalancesCapability, PendingCoin } from './v1/CoinsAndBalances';
import { KeysCapability } from './v1/Keys';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { SubmissionEvent, SubmissionEventCases } from './v1/Submission';
import { FinalizedTransaction } from './v1/types/ledger';
import { TokenTransfer } from './v1/Transacting';

export type ShieldedWalletCapabilities = {
  serialization: SerializationCapability<V1State, ledger.ZswapSecretKeys, string>;
  coinsAndBalances: CoinsAndBalancesCapability<V1State>;
  keys: KeysCapability<V1State>;
  transactionHistory: TransactionHistoryCapability<V1State, FinalizedTransaction>;
};

export class ShieldedWalletState {
  static readonly mapState =
    (capabilities: ShieldedWalletCapabilities) =>
    (state: ProtocolState.ProtocolState<V1State>): ShieldedWalletState => {
      return new ShieldedWalletState(state, capabilities);
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: V1State;
  readonly capabilities: ShieldedWalletCapabilities;

  get balances(): Record<ledger.RawTokenType, bigint> {
    return this.capabilities.coinsAndBalances.getAvailableBalances(this.state);
  }

  get totalCoins(): readonly (AvailableCoin | PendingCoin)[] {
    return this.capabilities.coinsAndBalances.getTotalCoins(this.state);
  }

  get availableCoins(): readonly AvailableCoin[] {
    return this.capabilities.coinsAndBalances.getAvailableCoins(this.state);
  }

  get pendingCoins(): readonly AvailableCoin[] {
    return this.capabilities.coinsAndBalances.getAvailableCoins(this.state);
  }

  get coinPublicKey(): ShieldedCoinPublicKey {
    return this.capabilities.keys.getCoinPublicKey(this.state);
  }

  get encryptionPublicKey(): ShieldedEncryptionPublicKey {
    return this.capabilities.keys.getEncryptionPublicKey(this.state);
  }

  get address(): ShieldedAddress {
    return this.capabilities.keys.getAddress(this.state);
  }

  get progress(): ProgressUpdate {
    return this.capabilities.transactionHistory.progress(this.state);
  }

  get transactionHistory(): readonly FinalizedTransaction[] {
    return this.capabilities.transactionHistory.transactionHistory(this.state);
  }

  constructor(state: ProtocolState.ProtocolState<V1State>, capabilities: ShieldedWalletCapabilities) {
    this.protocolVersion = state.version;
    this.state = state.state;
    this.capabilities = capabilities;
  }

  serialize(): string {
    return this.capabilities.serialization.serialize(this.state);
  }
}

export type SubmitTransactionMethod<TTransaction> = {
  (transaction: TTransaction, waitForStatus: 'Submitted'): Promise<SubmissionEventCases.Submitted>;
  (transaction: TTransaction, waitForStatus: 'InBlock'): Promise<SubmissionEventCases.InBlock>;
  (transaction: TTransaction, waitForStatus: 'Finalized'): Promise<SubmissionEventCases.Finalized>;
  (transaction: TTransaction): Promise<SubmissionEventCases.InBlock>;
  (transaction: TTransaction, waitForStatus?: 'Submitted' | 'InBlock' | 'Finalized'): Promise<SubmissionEvent>;
};

export interface ShieldedWallet extends WalletLike.WalletLike<[VersionedVariant<DefaultV1Variant>]> {
  readonly state: rx.Observable<ShieldedWalletState>;

  // we can balance bound and unbound txs
  balanceTransaction(
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
    newCoins: readonly ledger.ShieldedCoinInfo[],
  ): Promise<ProvingRecipe<ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>>>;

  transferTransaction(outputs: readonly TokenTransfer[]): Promise<ProvingRecipe<FinalizedTransaction>>;

  initSwap(
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
  ): Promise<ProvingRecipe<FinalizedTransaction>>;

  finalizeTransaction(
    recipe: ProvingRecipe<ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>>,
  ): Promise<FinalizedTransaction>;

  readonly submitTransaction: SubmitTransactionMethod<FinalizedTransaction>;

  serializeState(): Promise<string>;

  waitForSyncedState(maxGap?: bigint): Promise<ShieldedWalletState>;
}

export interface ShieldedWalletClass extends WalletLike.BaseWalletClass<[VersionedVariant<DefaultV1Variant>]> {
  startWithShieldedSeed(seed: Uint8Array): ShieldedWallet;
  restore(seed: Uint8Array, serializedState: string): ShieldedWallet;
}

export function ShieldedWallet(configuration: DefaultV1Configuration): ShieldedWalletClass {
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, new V1Builder().withDefaults())
    .build(configuration);

  return class ShieldedWalletImplementation extends BaseWallet implements ShieldedWallet {
    static startWithShieldedSeed(seed: Uint8Array): ShieldedWalletImplementation {
      return ShieldedWalletImplementation.startFirst(
        ShieldedWalletImplementation,
        V1State.initEmpty(ledger.ZswapSecretKeys.fromSeed(seed), ShieldedWalletImplementation.configuration.networkId),
      );
    }

    static restore(seed: Uint8Array, serializedState: string): ShieldedWalletImplementation {
      const deserialized: V1State = ShieldedWalletImplementation.allVariantsRecord()
        [V1Tag].variant.deserializeState(ledger.ZswapSecretKeys.fromSeed(seed), serializedState)
        .pipe(Either.getOrThrow);
      return ShieldedWalletImplementation.startFirst(ShieldedWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<ShieldedWalletState>;

    constructor(runtime: Runtime<[VersionedVariant<DefaultV1Variant>]>, scope: Scope.CloseableScope) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(ShieldedWalletState.mapState(ShieldedWalletImplementation.allVariantsRecord()[V1Tag].variant)),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    balanceTransaction(
      tx: FinalizedTransaction,
      newCoins: readonly ledger.ShieldedCoinInfo[],
    ): Promise<ProvingRecipe<FinalizedTransaction>> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.balanceTransaction(tx, newCoins),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[]): Promise<ProvingRecipe<FinalizedTransaction>> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.transferTransaction(outputs),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
    ): Promise<ProvingRecipe<FinalizedTransaction>> {
      return this.runtime
        .dispatch({ [V1Tag]: (v1) => v1.initSwap(desiredInputs, desiredOutputs) })
        .pipe(Effect.runPromise);
    }

    finalizeTransaction(recipe: ProvingRecipe<FinalizedTransaction>): Promise<FinalizedTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.finalizeTransaction(recipe),
        })
        .pipe(Effect.runPromise);
    }

    submitTransaction: SubmitTransactionMethod<FinalizedTransaction> = ((
      tx: FinalizedTransaction,
      waitForStatus: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
    ) => {
      return this.runtime
        .dispatch({ [V1Tag]: (v1) => v1.submitTransaction(tx, waitForStatus) })
        .pipe(Effect.runPromise);
    }) as SubmitTransactionMethod<FinalizedTransaction>;

    waitForSyncedState(maxGap?: bigint): Promise<ShieldedWalletState> {
      return rx.firstValueFrom(this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(maxGap))));
    }

    /**
     * Serializes the most recent state
     * It's preferable to use [[ShieldedWalletState.serialize]] instead, to know exactly, which state is serialized
     */
    serializeState(): Promise<string> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }
  };
}
