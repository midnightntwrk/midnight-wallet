import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/abstractions';
import { WalletBuilder } from './WalletBuilder';
import { DefaultV1Configuration, DefaultV1Variant, V1Builder, V1State, V1Tag } from './v1';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, Either, Scope } from 'effect';
import * as rx from 'rxjs';
import { Runtime } from './Runtime';
import { VersionedVariant } from './abstractions/Variant';
import { WalletLike } from './abstractions';
import { ProvingRecipe } from './v1/ProvingRecipe';
import { TokenTransfer } from '@midnight-ntwrk/wallet-api';
import { SerializationCapability } from './v1/Serialization';
import { AvailableCoin, CoinsAndBalancesCapability, PendingCoin } from './v1/CoinsAndBalances';
import { KeysCapability } from './v1/Keys';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { SubmissionEvent, SubmissionEventCases } from './v1/Submission';

export type ShieldedWalletCapabilities = {
  serialization: SerializationCapability<V1State, zswap.SecretKeys, string>;
  coinsAndBalances: CoinsAndBalancesCapability<V1State>;
  keys: KeysCapability<V1State>;
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

  get balances(): Record<zswap.TokenType, bigint> {
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

  balanceTransaction(
    tx: zswap.Transaction,
    newCoins: readonly zswap.CoinInfo[],
  ): Promise<ProvingRecipe<zswap.Transaction>>;

  transferTransaction(outputs: readonly TokenTransfer[]): Promise<ProvingRecipe<zswap.Transaction>>;

  initSwap(
    desiredInputs: Record<zswap.TokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
  ): Promise<ProvingRecipe<zswap.Transaction>>;

  finalizeTransaction(recipe: ProvingRecipe<zswap.Transaction>): Promise<zswap.Transaction>;

  readonly submitTransaction: SubmitTransactionMethod<zswap.Transaction>;

  serializeState(): Promise<string>;

  waitForSyncedState(allowedGap?: bigint): Promise<ShieldedWalletState>;
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
        V1State.initEmpty(zswap.SecretKeys.fromSeed(seed), ShieldedWalletImplementation.configuration.networkId),
      );
    }

    static restore(seed: Uint8Array, serializedState: string): ShieldedWalletImplementation {
      const deserialized: V1State = ShieldedWalletImplementation.allVariantsRecord()
        [V1Tag].variant.deserializeState(zswap.SecretKeys.fromSeed(seed), serializedState)
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
      tx: zswap.Transaction,
      newCoins: readonly zswap.CoinInfo[],
    ): Promise<ProvingRecipe<zswap.Transaction>> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.balanceTransaction(tx, newCoins),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[]): Promise<ProvingRecipe<zswap.Transaction>> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.transferTransaction(outputs),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<zswap.TokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
    ): Promise<ProvingRecipe<zswap.Transaction>> {
      return this.runtime
        .dispatch({ [V1Tag]: (v1) => v1.initSwap(desiredInputs, desiredOutputs) })
        .pipe(Effect.runPromise);
    }

    finalizeTransaction(recipe: ProvingRecipe<zswap.Transaction>): Promise<zswap.Transaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.finalizeTransaction(recipe),
        })
        .pipe(Effect.runPromise);
    }

    submitTransaction: SubmitTransactionMethod<zswap.Transaction> = ((
      tx: zswap.Transaction,
      waitForStatus: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
    ) => {
      return this.runtime
        .dispatch({ [V1Tag]: (v1) => v1.submitTransaction(tx, waitForStatus) })
        .pipe(Effect.runPromise);
    }) as SubmitTransactionMethod<zswap.Transaction>;

    waitForSyncedState(allowedGap: bigint = 0n): Promise<ShieldedWalletState> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
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
