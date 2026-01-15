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
import { Either, pipe, BigInt as BigIntOps, Iterable as IterableOps, Option } from 'effect';
import {
  DustActions,
  DustPublicKey,
  DustRegistration,
  DustSecretKey,
  Intent,
  PreBinding,
  PreProof,
  Signature,
  SignatureEnabled,
  SignatureVerifyingKey,
  Transaction,
  UnshieldedOffer,
  UtxoOutput,
  UtxoSpend,
  FinalizedTransaction,
  ProofErasedTransaction,
  UnprovenTransaction,
  addressFromKey,
  LedgerParameters,
  nativeToken,
} from '@midnight-ntwrk/ledger-v7';
import { MidnightBech32m, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { DustCoreWallet } from './DustCoreWallet.js';
import { AnyTransaction, DustToken, NetworkId, TotalCostParameters } from './types/index.js';
import { CoinsAndBalancesCapability, CoinSelection, UtxoWithFullDustDetails } from './CoinsAndBalances.js';
import { KeysCapability } from './Keys.js';
import { BindingMarker, ProofMarker, SignatureMarker } from './Utils.js';

export interface TransactingCapability<TSecrets, TState, TTransaction> {
  readonly networkId: NetworkId;
  readonly costParams: TotalCostParameters;
  createDustGenerationTransaction(
    currentTime: Date,
    ttl: Date,
    nightUtxos: ReadonlyArray<UtxoWithFullDustDetails>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: string | undefined,
  ): Either.Either<UnprovenTransaction, WalletError.WalletError>;

  addDustGenerationSignature(
    transaction: UnprovenTransaction,
    signature: Signature,
  ): Either.Either<UnprovenTransaction, WalletError.WalletError>;

  calculateFee(transaction: AnyTransaction, ledgerParams: LedgerParameters): bigint;

  balanceTransactions(
    secretKey: TSecrets,
    state: TState,
    transactions: ReadonlyArray<AnyTransaction>,
    ttl: Date,
    currentTime: Date,
    ledgerParams: LedgerParameters,
  ): Either.Either<[UnprovenTransaction, TState], WalletError.WalletError>;

  revertTransaction(
    state: TState,
    transaction: UnprovenTransaction | TTransaction,
  ): Either.Either<TState, WalletError.WalletError>;
}

export type DefaultTransactingConfiguration = {
  networkId: NetworkId;
  costParameters: TotalCostParameters;
};

export type DefaultTransactingContext = {
  coinSelection: CoinSelection<DustToken>;
  coinsAndBalancesCapability: CoinsAndBalancesCapability<DustCoreWallet>;
  keysCapability: KeysCapability<DustCoreWallet>;
};

export const makeDefaultTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<DustSecretKey, DustCoreWallet, FinalizedTransaction> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    config.costParameters,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
  );
};

export const makeSimulatorTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<DustSecretKey, DustCoreWallet, ProofErasedTransaction> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    config.costParameters,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
  );
};

export class TransactingCapabilityImplementation<TTransaction extends AnyTransaction> implements TransactingCapability<
  DustSecretKey,
  DustCoreWallet,
  TTransaction
> {
  public readonly networkId: string;
  public readonly costParams: TotalCostParameters;
  public readonly getCoinSelection: () => CoinSelection<DustToken>;
  readonly getCoins: () => CoinsAndBalancesCapability<DustCoreWallet>;
  readonly getKeys: () => KeysCapability<DustCoreWallet>;

  constructor(
    networkId: NetworkId,
    costParams: TotalCostParameters,
    getCoinSelection: () => CoinSelection<DustToken>,
    getCoins: () => CoinsAndBalancesCapability<DustCoreWallet>,
    getKeys: () => KeysCapability<DustCoreWallet>,
  ) {
    this.getCoins = getCoins;
    this.networkId = networkId;
    this.costParams = costParams;
    this.getCoinSelection = getCoinSelection;
    this.getKeys = getKeys;
  }

  createDustGenerationTransaction(
    currentTime: Date,
    ttl: Date,
    nightUtxos: ReadonlyArray<UtxoWithFullDustDetails>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: string | undefined,
  ): Either.Either<UnprovenTransaction, WalletError.WalletError> {
    const makeOffer = (
      utxos: ReadonlyArray<UtxoWithFullDustDetails>,
    ): Option.Option<UnshieldedOffer<SignatureEnabled>> => {
      if (utxos.length === 0) {
        return Option.none();
      }
      const totalValue = pipe(
        utxos,
        IterableOps.map((coin) => coin.utxo.value),
        BigIntOps.sumAll,
      );
      const inputs: UtxoSpend[] = utxos.map(({ utxo }) => ({
        ...utxo,
        owner: nightVerifyingKey,
      }));
      const output: UtxoOutput = {
        owner: addressFromKey(nightVerifyingKey),
        type: nativeToken().raw,
        value: totalValue,
      };

      return Option.some(UnshieldedOffer.new(inputs, [output], []));
    };

    return Either.gen(this, function* () {
      const receiver = dustReceiverAddress ? yield* this.#parseAddress(dustReceiverAddress) : undefined;

      return yield* LedgerOps.ledgerTry(() => {
        const network = this.networkId;

        const splitResult = this.getCoins().splitNightUtxos(nightUtxos);

        const totalDustValue = pipe(
          splitResult.guaranteed,
          IterableOps.map((coin) => coin.dust.generatedNow),
          BigIntOps.sumAll,
        );

        const maybeGuaranteedOffer = makeOffer(splitResult.guaranteed);
        const maybeFallibleOffer = makeOffer(splitResult.fallible);

        const dustRegistration: DustRegistration<SignatureEnabled> = new DustRegistration(
          SignatureMarker.signature,
          nightVerifyingKey,
          receiver,
          dustReceiverAddress !== undefined ? totalDustValue : 0n,
        );
        const dustActions = new DustActions<SignatureEnabled, PreProof>(
          SignatureMarker.signature,
          ProofMarker.preProof,
          currentTime,
          [],
          [dustRegistration],
        );

        const intent = pipe(
          Intent.new(ttl),
          (intent) =>
            Option.match(maybeGuaranteedOffer, {
              onNone: () => intent,
              onSome: (guaranteedOffer) => {
                intent.guaranteedUnshieldedOffer = guaranteedOffer;
                return intent;
              },
            }),
          (intent) =>
            Option.match(maybeFallibleOffer, {
              onNone: () => intent,
              onSome: (fallibleOffer) => {
                intent.fallibleUnshieldedOffer = fallibleOffer;
                return intent;
              },
            }),
          (intent) => {
            intent.dustActions = dustActions;
            return intent;
          },
        );

        return Transaction.fromParts(network, undefined, undefined, intent);
      });
    });
  }

  addDustGenerationSignature(
    transaction: UnprovenTransaction,
    signatureData: Signature,
  ): Either.Either<UnprovenTransaction, WalletError.WalletError> {
    return Either.gen(this, function* () {
      const intent = transaction.intents?.get(1);
      if (!intent) {
        return yield* Either.left(
          new WalletError.TransactingError({ message: 'No intent found in the transaction intents with segment = 1' }),
        );
      }

      const { dustActions, guaranteedUnshieldedOffer, fallibleUnshieldedOffer } = intent;
      if (!dustActions) {
        return yield* Either.left(new WalletError.TransactingError({ message: 'No dustActions found in intent' }));
      }

      if (!guaranteedUnshieldedOffer) {
        return yield* Either.left(
          new WalletError.TransactingError({ message: 'No guaranteedUnshieldedOffer found in intent' }),
        );
      }

      const [registration, ...restRegistrations] = dustActions.registrations;
      if (!registration) {
        return yield* Either.left(
          new WalletError.TransactingError({ message: 'No registrations found in dustActions' }),
        );
      }

      return yield* LedgerOps.ledgerTry(() => {
        const signature = new SignatureEnabled(signatureData);
        const registrationWithSignature = new DustRegistration(
          signature.instance,
          registration.nightKey,
          registration.dustAddress,
          registration.allowFeePayment,
          signature,
        );
        const newDustActions = new DustActions(
          signature.instance,
          ProofMarker.preProof,
          dustActions.ctime,
          dustActions.spends,
          [registrationWithSignature, ...restRegistrations],
        );

        // make a copy of intent to avoid mutation
        const newIntent = Intent.deserialize<SignatureEnabled, PreProof, PreBinding>(
          signature.instance,
          ProofMarker.preProof,
          BindingMarker.preBinding,
          intent.serialize(),
        );
        newIntent.dustActions = newDustActions;

        const inputsLen = guaranteedUnshieldedOffer.inputs.length;
        const signatures: Signature[] = [];
        for (let i = 0; i < inputsLen; ++i) {
          signatures.push(guaranteedUnshieldedOffer.signatures.at(i) ?? signatureData);
        }
        newIntent.guaranteedUnshieldedOffer = guaranteedUnshieldedOffer.addSignatures(signatures);

        if (fallibleUnshieldedOffer) {
          const inputsLen = fallibleUnshieldedOffer.inputs.length;
          const signatures: Signature[] = [];
          for (let i = 0; i < inputsLen; ++i) {
            signatures.push(fallibleUnshieldedOffer.signatures.at(i) ?? signatureData);
          }
          newIntent.fallibleUnshieldedOffer = fallibleUnshieldedOffer.addSignatures(signatures);
        }

        // make a copy of transaction to avoid mutation
        const newTransaction = Transaction.deserialize<SignatureEnabled, PreProof, PreBinding>(
          signature.instance,
          ProofMarker.preProof,
          BindingMarker.preBinding,
          transaction.serialize(),
        );
        newTransaction.intents = newTransaction.intents!.set(1, newIntent);

        return newTransaction;
      });
    });
  }

  calculateFee(transaction: AnyTransaction, ledgerParams: LedgerParameters): bigint {
    return (
      transaction.feesWithMargin(ledgerParams, this.costParams.feeBlocksMargin) + this.costParams.additionalFeeOverhead
    );
  }

  static feeImbalance(transaction: AnyTransaction, totalFee: bigint): bigint {
    const dustImbalance = transaction
      .imbalances(0, totalFee)
      .entries()
      .find(([tt, _]) => tt.tag === 'dust');
    return dustImbalance ? -dustImbalance[1] : totalFee;
  }

  balanceTransactions(
    secretKey: DustSecretKey,
    state: DustCoreWallet,
    transactions: ReadonlyArray<FinalizedTransaction | UnprovenTransaction>,
    ttl: Date,
    currentTime: Date,
    ledgerParams: LedgerParameters,
  ): Either.Either<[UnprovenTransaction, DustCoreWallet], WalletError.WalletError> {
    const network = this.networkId;
    const feeLeft = transactions.reduce(
      (total, transaction) =>
        total +
        TransactingCapabilityImplementation.feeImbalance(transaction, this.calculateFee(transaction, ledgerParams)),
      0n,
    );

    const dustTokens = this.getCoins().getAvailableCoinsWithGeneratedDust(state, currentTime);
    const selectedTokens = this.getCoinSelection()(dustTokens, feeLeft);
    if (!selectedTokens.length) {
      return Either.left(new WalletError.TransactingError({ message: 'No dust tokens found in the wallet state' }));
    }

    const totalFeeInSelected = selectedTokens.reduce((total, { value }) => total + value, 0n);
    const feeDiff = totalFeeInSelected - feeLeft;
    if (feeDiff < 0n) {
      return Either.left(new WalletError.TransactingError({ message: 'Not enough Dust generated to pay the fee' }));
    }

    // reduce the largest token's value by `feeDiff`
    const tokensWithFeeToTake = selectedTokens.toSorted((a, b) => Number(b.value - a.value));
    if (feeDiff > 0n) {
      const highestByValue = tokensWithFeeToTake[0];
      tokensWithFeeToTake[0] = {
        value: highestByValue.value - feeDiff,
        token: highestByValue.token,
      };
    }

    return LedgerOps.ledgerTry(() => {
      const intent = Intent.new(ttl);
      const [spends, updatedState] = state.spendCoins(secretKey, tokensWithFeeToTake, currentTime);

      intent.dustActions = new DustActions<SignatureEnabled, PreProof>(
        SignatureMarker.signature,
        ProofMarker.preProof,
        currentTime,
        [...spends],
        [],
      );

      const feeTransaction = Transaction.fromPartsRandomized(network, undefined, undefined, intent);

      return [feeTransaction, updatedState];
    });
  }

  revertTransaction(
    state: DustCoreWallet,
    transaction: UnprovenTransaction | TTransaction,
  ): Either.Either<DustCoreWallet, WalletError.WalletError> {
    return Either.try({
      try: () => state.revertTransaction(transaction),
      catch: (err) => {
        return new WalletError.OtherWalletError({
          message: `Error while reverting transaction ${transaction.identifiers().at(0)!}`,
          cause: err,
        });
      },
    });
  }

  #parseAddress(addr: string): Either.Either<DustPublicKey, WalletError.AddressError> {
    return Either.try({
      try: () => {
        const repr = MidnightBech32m.parse(addr);
        return DustAddress.codec.decode(this.networkId, repr).data;
      },
      catch: (err) => {
        return new WalletError.AddressError({
          message: `Address parsing error: ${addr}`,
          originalAddress: addr,
          cause: err,
        });
      },
    });
  }
}
