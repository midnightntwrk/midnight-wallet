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
import { Effect, Either, pipe, BigInt as BigIntOps, Iterable as IterableOps, Option } from 'effect';
import {
  DustActions,
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
} from '@midnight-ntwrk/ledger-v8';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { OtherWalletError, TransactingError, WalletError, InsufficientFundsError } from './WalletError.js';
import { LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { CoreWallet } from './CoreWallet.js';
import { AnyTransaction, Dust, NetworkId, TotalCostParameters } from './types/index.js';
import {
  CoinsAndBalancesCapability,
  CoinSelection,
  CoinWithValue,
  UtxoWithFullDustDetails,
} from './CoinsAndBalances.js';
import { KeysCapability } from './Keys.js';
import { BindingMarker, ProofMarker, SignatureMarker } from './Utils.js';
import {
  getBalanceRecipe,
  Imbalances as CapImbalances,
  InsufficientFundsError as BalancingInsufficientFundsError,
} from '@midnight-ntwrk/wallet-sdk-capabilities';

// This interface should abstract over the transaction types used
// It does not do so now for historical reasons
export interface TransactingCapability<TSecrets, TState, _TTransaction> {
  readonly networkId: NetworkId;
  readonly costParams: TotalCostParameters;
  createDustGenerationTransaction(
    currentTime: Date,
    ttl: Date,
    nightUtxos: ReadonlyArray<UtxoWithFullDustDetails>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: DustAddress | undefined,
  ): Either.Either<UnprovenTransaction, WalletError>;

  addDustGenerationSignature(
    transaction: UnprovenTransaction,
    signature: Signature,
  ): Either.Either<UnprovenTransaction, WalletError>;

  calculateFee(transaction: AnyTransaction, ledgerParams: LedgerParameters): bigint;

  estimateFee(
    secretKey: TSecrets,
    state: TState,
    transactions: ReadonlyArray<AnyTransaction>,
    ttl: Date,
    currentTime: Date,
    ledgerParams: LedgerParameters,
  ): Either.Either<bigint, WalletError>;

  balanceTransactions(
    secretKey: TSecrets,
    state: TState,
    transactions: ReadonlyArray<AnyTransaction>,
    ttl: Date,
    currentTime: Date,
    ledgerParams: LedgerParameters,
  ): Either.Either<[UnprovenTransaction, TState], WalletError>;

  revertTransaction(state: TState, transaction: AnyTransaction): Either.Either<TState, WalletError>;
}

export type DefaultTransactingConfiguration = {
  networkId: NetworkId;
  costParameters: TotalCostParameters;
};

export type DefaultTransactingContext = {
  coinSelection: CoinSelection<Dust>;
  coinsAndBalancesCapability: CoinsAndBalancesCapability<CoreWallet>;
  keysCapability: KeysCapability<CoreWallet>;
};

export const makeDefaultTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<DustSecretKey, CoreWallet, FinalizedTransaction> => {
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
): TransactingCapability<DustSecretKey, CoreWallet, ProofErasedTransaction> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    config.costParameters,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
  );
};

/**
 * Distributes the fee across multiple inputs, draining smaller inputs first when the fee exceeds any single input's
 * value.
 */
const distributeFeeAcrossInputs = <T extends { value: bigint }>(
  inputs: ReadonlyArray<T>,
  fee: bigint,
): ReadonlyArray<T> =>
  inputs.reduce<{ result: T[]; remaining: bigint }>(
    ({ result, remaining }, input) => {
      const deduction = remaining >= input.value ? input.value : remaining;
      return { result: [...result, { ...input, value: deduction }], remaining: remaining - deduction };
    },
    { result: [], remaining: fee },
  ).result;

export class TransactingCapabilityImplementation<TTransaction extends AnyTransaction> implements TransactingCapability<
  DustSecretKey,
  CoreWallet,
  TTransaction
> {
  public readonly networkId: string;
  public readonly costParams: TotalCostParameters;
  public readonly getCoinSelection: () => CoinSelection<Dust>;
  readonly getCoins: () => CoinsAndBalancesCapability<CoreWallet>;
  readonly getKeys: () => KeysCapability<CoreWallet>;

  constructor(
    networkId: NetworkId,
    costParams: TotalCostParameters,
    getCoinSelection: () => CoinSelection<Dust>,
    getCoins: () => CoinsAndBalancesCapability<CoreWallet>,
    getKeys: () => KeysCapability<CoreWallet>,
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
    dustReceiverAddress: DustAddress | undefined,
  ): Either.Either<UnprovenTransaction, WalletError> {
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
      const receiver = dustReceiverAddress ? dustReceiverAddress.data : undefined;

      return yield* LedgerOps.ledgerTry(() => {
        const network = this.networkId;

        const splitResult = this.getCoins().splitNightUtxos(nightUtxos);

        // if receiver is `undefined`, it means the coin(s) are being deregistered so the allowFeePayment should not be used
        const feePayment = receiver
          ? pipe(
              splitResult.guaranteed,
              IterableOps.filter((coin) => !coin.utxo.registeredForDustGeneration),
              IterableOps.map((coin) => coin.dust.generatedNow),
              BigIntOps.sumAll,
            )
          : 0n;

        const maybeGuaranteedOffer = makeOffer(splitResult.guaranteed);
        const maybeFallibleOffer = makeOffer(splitResult.fallible);

        const dustRegistration: DustRegistration<SignatureEnabled> = new DustRegistration(
          SignatureMarker.signature,
          nightVerifyingKey,
          receiver,
          feePayment,
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
  ): Either.Either<UnprovenTransaction, WalletError> {
    return Either.gen(this, function* () {
      const intent = transaction.intents?.get(1);
      if (!intent) {
        return yield* Either.left(
          new TransactingError({ message: 'No intent found in the transaction intents with segment = 1' }),
        );
      }

      const { dustActions, guaranteedUnshieldedOffer, fallibleUnshieldedOffer } = intent;
      if (!dustActions) {
        return yield* Either.left(new TransactingError({ message: 'No dustActions found in intent' }));
      }

      if (!guaranteedUnshieldedOffer) {
        return yield* Either.left(new TransactingError({ message: 'No guaranteedUnshieldedOffer found in intent' }));
      }

      const [registration, ...restRegistrations] = dustActions.registrations;
      if (!registration) {
        return yield* Either.left(new TransactingError({ message: 'No registrations found in dustActions' }));
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
      transaction.feesWithMargin(ledgerParams, this.costParams.feeBlocksMargin) +
      (this.costParams.additionalFeeOverhead ?? 0n)
    );
  }

  dryRunFee(
    recipeInputs: ReadonlyArray<CoinWithValue<Dust>>,
    transactions: ReadonlyArray<FinalizedTransaction | UnprovenTransaction>,
    secretKey: DustSecretKey,
    state: CoreWallet,
    ttl: Date,
    currentTime: Date,
    ledgerParams: LedgerParameters,
  ): bigint {
    const network = this.networkId;

    // Create a balancing tx from recipe inputs without persisting state changes
    const [spends] = CoreWallet.spendCoins(state, secretKey, recipeInputs, currentTime);

    const intent = Intent.new(ttl);
    intent.dustActions = new DustActions<SignatureEnabled, PreProof>(
      SignatureMarker.signature,
      ProofMarker.preProof,
      currentTime,
      [...spends],
      [],
    );

    const balancingTx = Transaction.fromPartsRandomized(network, undefined, undefined, intent);

    // Erase proofs on everything and merge
    const erasedBalancing = balancingTx.eraseProofs();
    const mergedTx = transactions.reduce((acc, tx) => acc.merge(tx.eraseProofs()), erasedBalancing);

    return this.calculateFee(mergedTx, ledgerParams);
  }

  static feeImbalance(transaction: AnyTransaction, totalFee: bigint): bigint {
    const [_, imbalance] =
      transaction
        .imbalances(0, totalFee)
        .entries()
        .find(([tt, _]) => tt.tag === 'dust') ?? [];

    return imbalance ?? 0n;
  }

  computeBalancingRecipe(
    secretKey: DustSecretKey,
    state: CoreWallet,
    transactions: ReadonlyArray<FinalizedTransaction | UnprovenTransaction>,
    ttl: Date,
    currentTime: Date,
    ledgerParams: LedgerParameters,
  ): Either.Either<{ fee: bigint; recipeInputs: ReadonlyArray<CoinWithValue<Dust>> }, WalletError> {
    const initialFees = transactions.reduce(
      (total, transaction) =>
        total +
        TransactingCapabilityImplementation.feeImbalance(transaction, this.calculateFee(transaction, ledgerParams)),
      0n,
    );

    const dust = this.getCoins().getAvailableCoinsWithGeneratedDust(state, currentTime);

    return pipe(
      Effect.iterate(
        { currentFee: initialFees, recipeInputs: [] as ReadonlyArray<CoinWithValue<Dust>>, converged: false } as {
          currentFee: bigint;
          recipeInputs: ReadonlyArray<CoinWithValue<Dust>>;
          converged: boolean;
        },
        {
          while: (s) => !s.converged,
          body: ({ currentFee }) =>
            Effect.try({
              try: () => {
                const recipe = getBalanceRecipe({
                  coins: dust.map((coin) => ({
                    type: 'dust',
                    value: coin.value,
                    token: coin.token,
                  })),
                  initialImbalances: CapImbalances.fromEntry('dust', currentFee),
                  feeTokenType: 'dust',
                  transactionCostModel: {
                    inputFeeOverhead: 0n,
                    outputFeeOverhead: 0n,
                  },
                  createOutput: (coin) => coin,
                  isCoinEqual: (a, b) => a.type === b.type && a.value === b.value,
                });

                const recipeInputs = recipe.inputs.map((input) => ({ token: input.token, value: input.value }));

                const newFee = this.dryRunFee(
                  recipeInputs,
                  transactions,
                  secretKey,
                  state,
                  ttl,
                  currentTime,
                  ledgerParams,
                );

                const recipeAmountCoverage = recipeInputs.reduce((sum, input) => sum + input.value, 0n);

                return { currentFee: newFee, recipeInputs, converged: newFee <= recipeAmountCoverage };
              },
              catch: (err) => {
                if (err instanceof BalancingInsufficientFundsError) {
                  return new InsufficientFundsError({
                    message: err.message,
                    tokenType: err.tokenType,
                  });
                } else {
                  return new OtherWalletError({
                    message: err instanceof Error ? err.message : 'Dust balancing failed',
                    cause: err,
                  });
                }
              },
            }),
        },
      ),
      Effect.either,
      Effect.runSync,
      Either.map(({ currentFee, recipeInputs }) => ({
        fee: currentFee,
        recipeInputs: distributeFeeAcrossInputs(recipeInputs, currentFee),
      })),
    );
  }

  estimateFee(
    secretKey: DustSecretKey,
    state: CoreWallet,
    transactions: ReadonlyArray<FinalizedTransaction | UnprovenTransaction>,
    ttl: Date,
    currentTime: Date,
    ledgerParams: LedgerParameters,
  ): Either.Either<bigint, WalletError> {
    return pipe(
      this.computeBalancingRecipe(secretKey, state, transactions, ttl, currentTime, ledgerParams),
      Either.map(({ fee }) => fee),
    );
  }

  balanceTransactions(
    secretKey: DustSecretKey,
    state: CoreWallet,
    transactions: ReadonlyArray<FinalizedTransaction | UnprovenTransaction>,
    ttl: Date,
    currentTime: Date,
    ledgerParams: LedgerParameters,
  ): Either.Either<[UnprovenTransaction, CoreWallet], WalletError> {
    const networkId = this.networkId;

    return pipe(
      this.computeBalancingRecipe(secretKey, state, transactions, ttl, currentTime, ledgerParams),
      Either.flatMap(({ recipeInputs }) => {
        return LedgerOps.ledgerTry(() => {
          const intent = Intent.new(ttl);
          const [spends, updatedState] = CoreWallet.spendCoins(state, secretKey, recipeInputs, currentTime);

          intent.dustActions = new DustActions<SignatureEnabled, PreProof>(
            SignatureMarker.signature,
            ProofMarker.preProof,
            currentTime,
            [...spends],
            [],
          );

          const feeTransaction = Transaction.fromPartsRandomized(networkId, undefined, undefined, intent);

          return [feeTransaction, updatedState];
        });
      }),
    );
  }

  revertTransaction(
    state: CoreWallet,
    transaction: UnprovenTransaction | TTransaction,
  ): Either.Either<CoreWallet, WalletError> {
    return Either.try({
      try: () => CoreWallet.revertTransaction(state, transaction),
      catch: (err) => {
        return new OtherWalletError({
          message: `Error while reverting transaction ${transaction.identifiers().at(0)!}`,
          cause: err,
        });
      },
    });
  }
}
