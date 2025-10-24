import {
  DustParameters,
  DustPublicKey,
  DustSecretKey,
  FinalizedTransaction,
  Signature,
  SignatureVerifyingKey,
  UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v6';
import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Runtime, WalletBuilder } from '@midnight-ntwrk/wallet-sdk-runtime';
import { Variant, WalletLike } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { ProvingRecipe, TransactionHistory } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { Effect, Either, Scope } from 'effect';
import * as rx from 'rxjs';
import { Balance, CoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { DustCoreWallet } from './DustCoreWallet.js';
import { KeysCapability } from './Keys.js';
import { V1Tag } from './RunningV1Variant.js';
import { SerializationCapability } from './Serialization.js';
import { SubmitTransactionMethod } from './Submission.js';
import { DustToken, DustTokenFullInfo, UtxoWithMeta } from './types/Dust.js';
import { AnyTransaction, NetworkId } from './types/ledger.js';
import { DefaultV1Configuration, DefaultV1Variant, V1Builder } from './V1Builder.js';

export type DustWalletCapabilities = {
  serialization: SerializationCapability<DustCoreWallet, null, string>;
  coinsAndBalances: CoinsAndBalancesCapability<DustCoreWallet>;
  keys: KeysCapability<DustCoreWallet>;
};

export class DustWalletState {
  static readonly mapState =
    (capabilities: DustWalletCapabilities) =>
    (state: ProtocolState.ProtocolState<DustCoreWallet>): DustWalletState => {
      return new DustWalletState(state, capabilities);
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: DustCoreWallet;
  readonly capabilities: DustWalletCapabilities;

  get totalCoins(): readonly DustToken[] {
    return this.capabilities.coinsAndBalances.getTotalCoins(this.state);
  }

  get availableCoins(): readonly DustToken[] {
    return this.capabilities.coinsAndBalances.getAvailableCoins(this.state);
  }

  get pendingCoins(): readonly DustToken[] {
    return this.capabilities.coinsAndBalances.getPendingCoins(this.state);
  }

  get dustPublicKey(): DustPublicKey {
    return this.capabilities.keys.getDustPublicKey(this.state);
  }

  get dustAddress(): string {
    return DustAddress.encodePublicKey(this.state.networkId, this.dustPublicKey);
  }

  get progress(): TransactionHistory.ProgressUpdate {
    return {
      appliedIndex: this.state.progress.appliedIndex,
      highestRelevantWalletIndex: this.state.progress.highestRelevantWalletIndex,
      highestIndex: this.state.progress.highestIndex,
      highestRelevantIndex: this.state.progress.highestRelevantIndex,
    };
  }

  constructor(state: ProtocolState.ProtocolState<DustCoreWallet>, capabilities: DustWalletCapabilities) {
    this.protocolVersion = state.version;
    this.state = state.state;
    this.capabilities = capabilities;
  }

  walletBalance(time: Date): Balance {
    return this.capabilities.coinsAndBalances.getWalletBalance(this.state, time);
  }

  availableCoinsWithFullInfo(time: Date): readonly DustTokenFullInfo[] {
    return this.capabilities.coinsAndBalances.getAvailableCoinsWithFullInfo(this.state, time);
  }

  serialize(): string {
    return this.capabilities.serialization.serialize(this.state);
  }
}

export interface DustWallet extends WalletLike.WalletLike<[Variant.VersionedVariant<DefaultV1Variant>]> {
  readonly state: rx.Observable<DustWalletState>;

  start(secretKey: DustSecretKey): Promise<void>;

  createDustGenerationTransaction(
    currentTime: Date,
    ttl: Date,
    nightUtxos: Array<UtxoWithMeta>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: string | undefined,
  ): Promise<UnprovenTransaction>;

  addDustGenerationSignature(
    transaction: UnprovenTransaction,
    signature: Signature,
  ): Promise<ProvingRecipe.ProvingRecipe<FinalizedTransaction>>;

  calculateFee(transaction: AnyTransaction): Promise<bigint>;

  addFeePayment(
    secretKey: DustSecretKey,
    transaction: UnprovenTransaction,
    currentTime: Date,
    ttl: Date,
  ): Promise<ProvingRecipe.ProvingRecipe<FinalizedTransaction>>;

  finalizeTransaction(recipe: ProvingRecipe.ProvingRecipe<FinalizedTransaction>): Promise<FinalizedTransaction>;

  readonly submitTransaction: SubmitTransactionMethod<FinalizedTransaction>;

  serializeState(): Promise<string>;

  waitForSyncedState(allowedGap?: bigint): Promise<DustWalletState>;
}

export interface DustWalletClass extends WalletLike.BaseWalletClass<[Variant.VersionedVariant<DefaultV1Variant>]> {
  startWithSeed(seed: Uint8Array, dustParameters: DustParameters, networkId: NetworkId): DustWallet;
  restore(serializedState: string): DustWallet;
}

export function DustWallet(configuration: DefaultV1Configuration): DustWalletClass {
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, new V1Builder().withDefaults())
    .build(configuration);

  return class DustWalletImplementation extends BaseWallet implements DustWallet {
    static startWithSeed(
      seed: Uint8Array,
      dustParameters: DustParameters,
      networkId: NetworkId,
    ): DustWalletImplementation {
      const dustSecretKey = DustSecretKey.fromSeed(seed);
      return DustWalletImplementation.startFirst(
        DustWalletImplementation,
        DustCoreWallet.initEmpty(dustParameters, dustSecretKey, networkId),
      );
    }

    static restore(serializedState: string): DustWalletImplementation {
      const deserialized: DustCoreWallet = DustWalletImplementation.allVariantsRecord()
        [V1Tag].variant.deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return DustWalletImplementation.startFirst(DustWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<DustWalletState>;

    constructor(runtime: Runtime.Runtime<[Variant.VersionedVariant<DefaultV1Variant>]>, scope: Scope.CloseableScope) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(DustWalletState.mapState(DustWalletImplementation.allVariantsRecord()[V1Tag].variant)),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(secretKey: DustSecretKey): Promise<void> {
      return this.runtime.dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground(secretKey) }).pipe(Effect.runPromise);
    }

    createDustGenerationTransaction(
      currentTime: Date,
      ttl: Date,
      nightUtxos: Array<UtxoWithMeta>,
      nightVerifyingKey: SignatureVerifyingKey,
      dustReceiverAddress: string | undefined,
    ): Promise<UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) =>
            v1.createDustGenerationTransaction(currentTime, ttl, nightUtxos, nightVerifyingKey, dustReceiverAddress),
        })
        .pipe(Effect.runPromise);
    }

    addDustGenerationSignature(
      transaction: UnprovenTransaction,
      signature: Signature,
    ): Promise<ProvingRecipe.ProvingRecipe<FinalizedTransaction>> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.addDustGenerationSignature(transaction, signature),
        })
        .pipe(Effect.runPromise);
    }

    calculateFee(transaction: AnyTransaction): Promise<bigint> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.calculateFee(transaction),
        })
        .pipe(Effect.runPromise);
    }

    addFeePayment(
      secretKey: DustSecretKey,
      transaction: UnprovenTransaction,
      currentTime: Date,
      ttl: Date,
    ): Promise<ProvingRecipe.ProvingRecipe<FinalizedTransaction>> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.addFeePayment(secretKey, transaction, currentTime, ttl),
        })
        .pipe(Effect.runPromise);
    }

    finalizeTransaction(recipe: ProvingRecipe.ProvingRecipe<FinalizedTransaction>): Promise<FinalizedTransaction> {
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
    }) as unknown as SubmitTransactionMethod<FinalizedTransaction>;

    waitForSyncedState(allowedGap: bigint = 0n): Promise<DustWalletState> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state
     * It's preferable to use [[DustWalletState.serialize]] instead, to know exactly, which state is serialized
     */
    serializeState(): Promise<string> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }
  };
}
