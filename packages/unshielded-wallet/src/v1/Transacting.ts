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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Either, Option, pipe } from 'effect';
import { CoreWallet } from './CoreWallet.js';
import { InsufficientFundsError, OtherWalletError, SignError, TransactingError, WalletError } from './WalletError.js';
import {
  BalanceRecipe,
  CoinSelection,
  getBalanceRecipe,
  Imbalances,
  InsufficientFundsError as BalancingInsufficientFundsError,
} from '@midnight-ntwrk/wallet-sdk-capabilities';
import { TransactionOps, UnboundTransaction, IntentOf } from './TransactionOps.js';
import { CoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { KeysCapability } from './Keys.js';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

const GUARANTEED_SEGMENT = 0;

export interface TokenTransfer {
  readonly amount: bigint;
  readonly type: ledger.RawTokenType;
  readonly receiverAddress: string;
}

export type FinalizedTransactionBalanceResult = ledger.UnprovenTransaction | undefined;

export type UnboundTransactionBalanceResult = UnboundTransaction | undefined;

export type UnprovenTransactionBalanceResult = ledger.UnprovenTransaction | undefined;

export type TransactingResult<TTransaction, TState> = {
  readonly newState: TState;
  readonly transaction: TTransaction;
};

export interface TransactingCapability<TState> {
  makeTransfer(
    wallet: CoreWallet,
    outputs: ReadonlyArray<TokenTransfer>,
    ttl: Date,
  ): Either.Either<TransactingResult<ledger.UnprovenTransaction, TState>, WalletError>;

  initSwap(
    wallet: CoreWallet,
    desiredInputs: Record<string, bigint>,
    outputs: ReadonlyArray<TokenTransfer>,
    ttl: Date,
  ): Either.Either<TransactingResult<ledger.UnprovenTransaction, TState>, WalletError>;

  balanceFinalizedTransaction(
    wallet: CoreWallet,
    transaction: ledger.FinalizedTransaction,
  ): Either.Either<[FinalizedTransactionBalanceResult, CoreWallet], WalletError>;

  balanceUnboundTransaction(
    wallet: CoreWallet,
    transaction: UnboundTransaction,
  ): Either.Either<[UnboundTransactionBalanceResult, CoreWallet], WalletError>;

  balanceUnprovenTransaction(
    wallet: CoreWallet,
    transaction: ledger.UnprovenTransaction,
  ): Either.Either<[UnprovenTransactionBalanceResult, CoreWallet], WalletError>;

  signTransaction(
    transaction: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Either.Either<ledger.UnprovenTransaction, WalletError>;
}

export type DefaultTransactingConfiguration = {
  networkId: NetworkId.NetworkId;
};

export type DefaultTransactingContext = {
  coinSelection: CoinSelection<ledger.Utxo>;
  coinsAndBalancesCapability: CoinsAndBalancesCapability<CoreWallet>;
  keysCapability: KeysCapability<CoreWallet>;
};

export const makeDefaultTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<CoreWallet> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
    TransactionOps,
  );
};

export class TransactingCapabilityImplementation implements TransactingCapability<CoreWallet> {
  public readonly networkId: NetworkId.NetworkId;
  public readonly getCoinSelection: () => CoinSelection<ledger.Utxo>;
  public readonly txOps: TransactionOps;
  readonly getCoins: () => CoinsAndBalancesCapability<CoreWallet>;
  readonly getKeys: () => KeysCapability<CoreWallet>;

  constructor(
    networkId: NetworkId.NetworkId,
    getCoinSelection: () => CoinSelection<ledger.Utxo>,
    getCoins: () => CoinsAndBalancesCapability<CoreWallet>,
    getKeys: () => KeysCapability<CoreWallet>,
    txOps: TransactionOps,
  ) {
    this.getCoins = getCoins;
    this.networkId = networkId;
    this.getCoinSelection = getCoinSelection;
    this.getKeys = getKeys;
    this.txOps = txOps;
  }

  /**
   * Balances an unbound transaction
   * Note: Unbound transactions are balanced in place and returned
   * @param wallet - The wallet to balance the transaction with
   * @param transaction - The transaction to balance
   * @returns The balanced transaction and the new wallet state if successful, otherwise an error
   */
  balanceUnboundTransaction(
    wallet: CoreWallet,
    transaction: UnboundTransaction,
  ): Either.Either<[UnboundTransactionBalanceResult, CoreWallet], WalletError> {
    return this.#balanceUnboundishTransaction(wallet, transaction);
  }

  /**
   * Balances an unproven transaction
   * Note: This method does the same thing as balanceUnboundTransaction but is provided for convenience and type safety
   * @param wallet - The wallet to balance the transaction with
   * @param transaction - The transaction to balance
   * @returns The balanced transaction and the new wallet state if successful, otherwise an error
   */
  balanceUnprovenTransaction(
    wallet: CoreWallet,
    transaction: ledger.UnprovenTransaction,
  ): Either.Either<[UnprovenTransactionBalanceResult, CoreWallet], WalletError> {
    return this.#balanceUnboundishTransaction(wallet, transaction);
  }

  /**
   * Balances a bound transaction
   * Note: In bound transactions we can only balance the guaranteed section in intents
   * @param wallet - The wallet to balance the transaction with
   * @param transaction - The transaction to balance
   * @returns A balancing counterpart transaction (which should be merged with the original transaction )
   * and the new wallet state if successful, otherwise an error
   */
  balanceFinalizedTransaction(
    wallet: CoreWallet,
    transaction: ledger.FinalizedTransaction,
  ): Either.Either<[FinalizedTransactionBalanceResult, CoreWallet], WalletError> {
    return Either.gen(this, function* () {
      // Ensure all intents are bound
      const segments = this.txOps.getSegments(transaction);

      for (const segment of segments) {
        const intent = transaction.intents?.get(segment);

        const isBound = this.txOps.isIntentBound(intent!);

        if (!isBound) {
          return yield* Either.left(new TransactingError({ message: `Intent with id ${segment} is not bound` }));
        }
      }

      // get the first intent so we can use its ttl to create the balancing intent
      const intent = transaction.intents?.get(segments[0]);

      const imbalances = this.txOps.getImbalances(transaction, GUARANTEED_SEGMENT);

      // guaranteed section is balanced
      if (imbalances.size === 0) {
        return [undefined, wallet];
      }

      const recipe = yield* this.#balanceSegment(wallet, imbalances, Imbalances.empty(), this.getCoinSelection());

      const { newState, offer } = yield* this.#prepareOffer(wallet, recipe);

      const balancingIntent = ledger.Intent.new(intent!.ttl);
      balancingIntent.guaranteedUnshieldedOffer = offer;

      return [ledger.Transaction.fromPartsRandomized(this.networkId, undefined, undefined, balancingIntent), newState];
    });
  }

  /**
   * Makes a transfer transaction
   * @param wallet - The wallet to make the transfer with
   * @param outputs - The outputs for the transfer
   * @param ttl - The TTL for the transaction
   * @returns The balanced transfer transaction and the new wallet state if successful, otherwise an error
   */
  makeTransfer(
    wallet: CoreWallet,
    outputs: ReadonlyArray<TokenTransfer>,
    ttl: Date,
  ): Either.Either<TransactingResult<ledger.UnprovenTransaction, CoreWallet>, WalletError> {
    return Either.gen(this, function* () {
      const { networkId } = this;

      const isValid = outputs.every((output) => output.amount > 0n);

      if (!isValid) {
        return yield* Either.left(new TransactingError({ message: 'The amount of all inputs needs to be positive' }));
      }

      const ledgerOutputs = outputs.map((output) => {
        return {
          value: output.amount,
          owner: UnshieldedAddress.codec
            .decode(networkId, MidnightBech32m.parse(output.receiverAddress))
            .data.toString('hex'),
          type: output.type,
        };
      });

      const recipe = yield* this.#balanceSegment(
        wallet,
        Imbalances.empty(),
        Imbalances.fromEntries(ledgerOutputs.map((output) => [output.type, output.value])),
        this.getCoinSelection(),
      );

      const { newState, offer } = yield* this.#prepareOffer(wallet, {
        inputs: recipe.inputs,
        outputs: [...recipe.outputs, ...ledgerOutputs],
      });

      const intent = ledger.Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = offer;

      return {
        newState,
        transaction: ledger.Transaction.fromParts(networkId, undefined, undefined, intent),
      };
    });
  }

  /**
   * Initializes a swap transaction
   * @param wallet - The wallet to initialize the swap for
   * @param desiredInputs - The desired inputs for the swap
   * @param desiredOutputs - The desired outputs for the swap
   * @param ttl - The TTL for the swap
   * @returns The initialized swap transaction and the new wallet state if successful, otherwise an error
   */
  initSwap(
    wallet: CoreWallet,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
    ttl: Date,
  ): Either.Either<TransactingResult<ledger.UnprovenTransaction, CoreWallet>, WalletError> {
    return Either.gen(this, function* () {
      const { networkId } = this;

      const outputsValid = desiredOutputs.every((output) => output.amount > 0n);
      if (!outputsValid) {
        return yield* Either.left(new TransactingError({ message: 'The amount of all outputs needs to be positive' }));
      }

      const inputsValid = Object.entries(desiredInputs).every(([, amount]) => amount > 0n);
      if (!inputsValid) {
        return yield* Either.left(new TransactingError({ message: 'The amount of all inputs needs to be positive' }));
      }

      const ledgerOutputs = desiredOutputs.map((output) => ({
        value: output.amount,
        owner: UnshieldedAddress.codec
          .decode(networkId, MidnightBech32m.parse(output.receiverAddress))
          .data.toString('hex'),
        type: output.type,
      }));

      const targetImbalances = Imbalances.fromEntries(Object.entries(desiredInputs));

      const recipe = yield* this.#balanceSegment(wallet, Imbalances.empty(), targetImbalances, this.getCoinSelection());

      const { newState, offer } = yield* this.#prepareOffer(wallet, {
        inputs: recipe.inputs,
        outputs: [...recipe.outputs, ...ledgerOutputs],
      });

      const intent = ledger.Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = offer;
      const tx = ledger.Transaction.fromParts(networkId, undefined, undefined, intent);

      return {
        newState,
        transaction: tx,
      };
    });
  }

  signTransaction(
    transaction: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Either.Either<ledger.UnprovenTransaction, WalletError> {
    return Either.gen(this, function* () {
      const segments = this.txOps.getSegments(transaction);
      if (!segments.length) {
        throw new SignError({ message: 'No segments found in the provided transaction' });
      }

      for (const segment of segments) {
        const signedData = yield* this.txOps.getSignatureData(transaction, segment);
        const signature = signSegment(signedData);
        transaction = yield* this.txOps.addSignature(transaction, signature, segment);
      }
      return transaction;
    });
  }

  /**
   * Balances a segment of a transaction
   * @param wallet - The wallet to balance the segment for
   * @param imbalances - The imbalances to balance the segment for
   * @param targetImbalances - The target imbalances to balance the segment for
   * @param coinSelection - The coin selection to use for the balance recipe
   * @returns The balance recipe if successful, otherwise an error
   */
  #balanceSegment(
    wallet: CoreWallet,
    imbalances: Imbalances,
    targetImbalances: Imbalances,
    coinSelection: CoinSelection<ledger.Utxo>,
  ): Either.Either<BalanceRecipe<ledger.Utxo, ledger.UtxoOutput>, WalletError> {
    return Either.try({
      try: () =>
        getBalanceRecipe<ledger.Utxo, ledger.UtxoOutput>({
          coins: this.getCoins()
            .getAvailableCoins(wallet)
            .map(({ utxo }) => utxo),
          initialImbalances: imbalances,
          feeTokenType: '',
          transactionCostModel: {
            inputFeeOverhead: 0n,
            outputFeeOverhead: 0n,
          },
          coinSelection,
          createOutput: (coin) => ({
            ...coin,
            owner: wallet.publicKey.addressHex,
          }),
          isCoinEqual: (a, b) => a.intentHash === b.intentHash && a.outputNo === b.outputNo,
          targetImbalances,
        }),
      catch: (err) => {
        if (err instanceof BalancingInsufficientFundsError) {
          return new InsufficientFundsError({
            message: 'Insufficient funds',
            tokenType: err.tokenType,
            amount: imbalances.get(err.tokenType) ?? 0n,
          });
        } else {
          return new OtherWalletError({
            message: 'Balancing unshielded segment failed',
            cause: err,
          });
        }
      },
    });
  }

  /**
   * Prepares an offer for a given balance recipe
   * @param wallet - The wallet to prepare the offer for
   * @param balanceRecipe - The balance recipe to prepare the offer for
   * @returns The prepared offer and the new wallet state if successful, otherwise an error
   */
  #prepareOffer(
    wallet: CoreWallet,
    balanceRecipe: BalanceRecipe<ledger.Utxo, ledger.UtxoOutput>,
  ): Either.Either<{ newState: CoreWallet; offer: ledger.UnshieldedOffer<ledger.SignatureEnabled> }, WalletError> {
    return Either.gen(function* () {
      const [spentInputs, updatedWallet] = yield* CoreWallet.spendUtxos(wallet, balanceRecipe.inputs);
      const { publicKey } = wallet.publicKey;

      const ledgerInputs = spentInputs.map((input) => ({
        ...input,
        intentHash: input.intentHash,
        owner: publicKey,
      }));

      const counterOffer = yield* Either.try({
        try: () => ledger.UnshieldedOffer.new(ledgerInputs, [...balanceRecipe.outputs], []),
        catch: (error) => new TransactingError({ message: 'Failed to create counter offer', cause: error }),
      });

      return {
        newState: updatedWallet,
        offer: counterOffer,
      };
    });
  }

  #mergeOffers(
    offerA: ledger.UnshieldedOffer<ledger.SignatureEnabled>,
    offerB?: ledger.UnshieldedOffer<ledger.SignatureEnabled>,
  ): Either.Either<ledger.UnshieldedOffer<ledger.SignatureEnabled>, WalletError> {
    return pipe(
      Option.fromNullable(offerB),
      Option.match({
        onNone: () => Either.right(offerA),
        onSome: (offerB) =>
          Either.try({
            try: () =>
              ledger.UnshieldedOffer.new(
                [...offerB.inputs, ...offerA.inputs],
                [...offerB.outputs, ...offerA.outputs],
                [...offerB.signatures, ...offerA.signatures],
              ),
            catch: (error) => new TransactingError({ message: 'Failed to merge offers', cause: error }),
          }),
      }),
    );
  }

  /**
   * Balances an unboundish (unproven or unbound) transaction
   * @param wallet - The wallet to balance the transaction with
   * @param transaction - The transaction to balance
   * @returns The balanced transaction and the new wallet state if successful, otherwise an error
   */
  #balanceUnboundishTransaction<T extends ledger.UnprovenTransaction | UnboundTransaction>(
    wallet: CoreWallet,
    transaction: T,
  ): Either.Either<[T | undefined, CoreWallet], WalletError> {
    return Either.gen(this, function* () {
      const segments = this.txOps.getSegments(transaction);

      // no segments to balance
      if (segments.length === 0) {
        return [undefined, wallet];
      }

      for (const segment of [...segments, GUARANTEED_SEGMENT]) {
        const imbalances = this.txOps.getImbalances(transaction, segment);

        // intent is balanced
        if (imbalances.size === 0) {
          continue;
        }

        // if segment is GUARANTEED_SEGMENT, use the first intent to balance guaranteed section
        const intentSegment = segment === GUARANTEED_SEGMENT ? segments[0] : segment;

        const intent = transaction.intents?.get(intentSegment) as IntentOf<T> | undefined;

        if (!intent) {
          return yield* Either.left(new TransactingError({ message: `Intent with id ${segment} was not found` }));
        }

        const isBound = this.txOps.isIntentBound(intent);

        if (isBound) {
          return yield* Either.left(new TransactingError({ message: `Intent with id ${segment} is already bound` }));
        }

        const recipe = yield* this.#balanceSegment(wallet, imbalances, Imbalances.empty(), this.getCoinSelection());

        const { offer } = yield* this.#prepareOffer(wallet, recipe);

        const targetOffer =
          segment !== GUARANTEED_SEGMENT ? intent.fallibleUnshieldedOffer : intent.guaranteedUnshieldedOffer;

        const mergedOffer = yield* this.#mergeOffers(offer, targetOffer);

        if (segment !== GUARANTEED_SEGMENT) {
          intent.fallibleUnshieldedOffer = mergedOffer;
        } else {
          intent.guaranteedUnshieldedOffer = mergedOffer;
        }

        (transaction.intents as Map<number, IntentOf<T>>)?.set(intentSegment, intent);
      }

      return [transaction, wallet];
    });
  }
}
