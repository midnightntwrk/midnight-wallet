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
import { SignError, TransactingError, WalletError } from './WalletError.js';
import { CoinSelection, getBalanceRecipe, Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { isIntentBound, TransactionTrait } from './Transaction.js';
import { CoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { KeysCapability } from './Keys.js';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

const GUARANTEED_SEGMENT = 0;

export interface TokenTransfer {
  readonly amount: bigint;
  readonly type: ledger.RawTokenType;
  readonly receiverAddress: string;
}

export type TransactingResult<TTransaction, TState> = {
  readonly newState: TState;
  readonly transaction: TTransaction;
};

const mergeCounterOffer = (
  counterOffer: ledger.UnshieldedOffer<ledger.SignatureEnabled>,
  currentOffer?: ledger.UnshieldedOffer<ledger.SignatureEnabled>,
): Either.Either<ledger.UnshieldedOffer<ledger.SignatureEnabled>, WalletError> =>
  pipe(
    Option.fromNullable(currentOffer),
    Option.match({
      onNone: () => Either.right(counterOffer),
      onSome: (currentOffer) =>
        Either.try({
          try: () =>
            ledger.UnshieldedOffer.new(
              [...currentOffer.inputs, ...counterOffer.inputs],
              [...currentOffer.outputs, ...counterOffer.outputs],
              [...currentOffer.signatures, ...counterOffer.signatures],
            ),
          catch: (error) => new TransactingError({ message: 'Failed to merge counter offers', cause: error }),
        }),
    }),
  );

export interface TransactingCapability<_TTransaction, TState> {
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

  balanceTransaction(
    wallet: CoreWallet,
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  ): Either.Either<
    TransactingResult<ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>, TState>,
    WalletError
  >;

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
): TransactingCapability<ledger.UnprovenTransaction, CoreWallet> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
    TransactionTrait.default,
  );
};

export class TransactingCapabilityImplementation<
  TTransaction extends ledger.UnprovenTransaction,
> implements TransactingCapability<ledger.UnprovenTransaction, CoreWallet> {
  public readonly networkId: NetworkId.NetworkId;
  public readonly getCoinSelection: () => CoinSelection<ledger.Utxo>;
  public readonly txTrait: TransactionTrait<TTransaction>;
  readonly getCoins: () => CoinsAndBalancesCapability<CoreWallet>;
  readonly getKeys: () => KeysCapability<CoreWallet>;

  constructor(
    networkId: NetworkId.NetworkId,
    getCoinSelection: () => CoinSelection<ledger.Utxo>,
    getCoins: () => CoinsAndBalancesCapability<CoreWallet>,
    getKeys: () => KeysCapability<CoreWallet>,
    txTrait: TransactionTrait<TTransaction>,
  ) {
    this.getCoins = getCoins;
    this.networkId = networkId;
    this.getCoinSelection = getCoinSelection;
    this.getKeys = getKeys;
    this.txTrait = txTrait;
  }

  balanceTransaction(
    wallet: CoreWallet,
    transaction: TTransaction,
  ): Either.Either<TransactingResult<TTransaction, CoreWallet>, WalletError> {
    return Either.gen(this, function* () {
      const segments = TransactionTrait.default.getSegments(transaction);

      if (!transaction.intents || !transaction.intents.size || !segments.length) {
        return {
          newState: wallet,
          transaction,
        };
      }

      const { addressHex, publicKey } = wallet.publicKey;

      for (const segment of [...segments, GUARANTEED_SEGMENT]) {
        const allIntentImbalances = yield* Either.try({
          try: () => transaction.imbalances(segment),
          catch: (error) => new TransactingError({ message: 'Failed to get intent imbalances', cause: error }),
        });
        const imbalances = allIntentImbalances
          .entries()
          .filter(([token, value]) => token.tag === 'unshielded' && value !== 0n)
          .map(([token, value]) => [token, value] as [ledger.UnshieldedTokenType, bigint])
          .map(([token, value]) => {
            return [token.raw, value] as [string, bigint];
          })
          .toArray();

        // // intent is balanced
        if (!imbalances.length) continue;

        const availableCoins = this.getCoins().getAvailableCoins(wallet);

        if (!availableCoins.length) {
          return yield* Either.left(new TransactingError({ message: 'No available coins to spend' }));
        }

        // select inputs, receive the change outputs
        const { inputs, outputs: changeOutputs } = yield* Either.try({
          try: () =>
            getBalanceRecipe<ledger.Utxo, ledger.UtxoOutput>({
              coins: availableCoins.map(({ utxo }) => utxo),
              initialImbalances: Imbalances.fromEntries(imbalances),
              feeTokenType: '',
              transactionCostModel: {
                inputFeeOverhead: 0n,
                outputFeeOverhead: 0n,
              },
              createOutput: (coin) => ({
                ...coin,
                owner: addressHex,
              }),
              isCoinEqual: (a, b) => a.intentHash === b.intentHash && a.outputNo === b.outputNo,
            }),
          catch: (error) => {
            const message = error instanceof Error ? error.message : error?.toString() || '';
            return new TransactingError({ message });
          },
        });

        // mark the coins as spent
        const [spentInputs] = yield* CoreWallet.spendUtxos(wallet, inputs);

        const ledgerInputs = spentInputs.map((input) => ({
          ...input,
          intentHash: input.intentHash,
          owner: publicKey,
        }));

        const counterOffer = yield* Either.try({
          try: () => ledger.UnshieldedOffer.new(ledgerInputs, changeOutputs, []),
          catch: (error) => new TransactingError({ message: 'Failed to create counter offer', cause: error }),
        });

        // NOTE: for the segment === 0 we insert the counter-offer into any intent's guaranteed section
        if (segment !== GUARANTEED_SEGMENT) {
          const intent = transaction.intents.get(segment)!;

          const isBound = isIntentBound(intent);
          if (!isBound && intent.fallibleUnshieldedOffer) {
            const mergedOffer = yield* mergeCounterOffer(counterOffer, intent.fallibleUnshieldedOffer);
            intent.fallibleUnshieldedOffer = mergedOffer;
            transaction.intents = transaction.intents.set(segment, intent);
          } else {
            // create a new offer if the intent is bound
            const nextSegment = Math.max(...TransactionTrait.default.getSegments(transaction)) + 1;
            const newIntent = ledger.Intent.new(intent.ttl);
            newIntent.fallibleUnshieldedOffer = counterOffer;
            transaction.intents = transaction.intents.set(nextSegment, newIntent);
          }
        } else {
          let ttl: Date = new Date();
          let updated = false;

          // try to find and modify any unbound intent first
          const segments = TransactionTrait.default.getSegments(transaction);
          for (const segment of segments) {
            const intent = transaction.intents.get(segment)!;
            ttl = intent.ttl;
            const isBound = isIntentBound(intent);
            if (!isBound) {
              const mergedOffer = yield* mergeCounterOffer(counterOffer, intent.guaranteedUnshieldedOffer);

              intent.guaranteedUnshieldedOffer = mergedOffer;
              transaction.intents = transaction.intents.set(segment, intent);

              updated = true;
              break;
            }
          }

          // no unbound intents found, insert a new one
          if (!updated) {
            const nextSegment = Math.max(...segments) + 1;
            const newIntent = ledger.Intent.new(ttl);
            newIntent.guaranteedUnshieldedOffer = counterOffer;
            transaction.intents = transaction.intents.set(nextSegment, newIntent);
          }
        }
      }
      return {
        newState: wallet,
        transaction: transaction,
      };
    });
  }

  makeTransfer(
    wallet: CoreWallet,
    outputs: ReadonlyArray<TokenTransfer>,
    ttl: Date,
  ): Either.Either<TransactingResult<TTransaction, CoreWallet>, WalletError> {
    const networkId = this.networkId;
    const isValid = outputs.every((output) => output.amount > 0n);
    if (!isValid) {
      throw new TransactingError({ message: 'The amount needs to be positive' });
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

    return Either.try({
      try: () => {
        const intent = ledger.Intent.new(ttl);
        intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], ledgerOutputs, []);
        return {
          newState: wallet,
          transaction: ledger.Transaction.fromParts(networkId, undefined, undefined, intent) as TTransaction,
        };
      },
      catch: (error) => new TransactingError({ message: 'Failed to create transaction', cause: error }),
    });
  }

  initSwap(
    wallet: CoreWallet,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
    ttl: Date,
  ): Either.Either<TransactingResult<TTransaction, CoreWallet>, WalletError> {
    return Either.gen(this, function* () {
      const networkId = this.networkId;
      const outputsValid = desiredOutputs.every((output) => output.amount > 0n);
      if (!outputsValid) {
        return yield* Either.left(new TransactingError({ message: 'The amount needs to be positive' }));
      }

      const inputsValid = Object.entries(desiredInputs).every(([, amount]) => amount > 0n);
      if (!inputsValid) {
        return yield* Either.left(new TransactingError({ message: 'The input amounts need to be positive' }));
      }

      const ledgerOutputs = desiredOutputs.map((output) => ({
        value: output.amount,
        owner: UnshieldedAddress.codec
          .decode(networkId, MidnightBech32m.parse(output.receiverAddress))
          .data.toString('hex'),
        type: output.type,
      }));

      const targetImbalances = Imbalances.fromEntries(Object.entries(desiredInputs));

      const availableCoins = this.getCoins().getAvailableCoins(wallet);

      const { inputs, outputs: changeOutputs } = yield* Either.try({
        try: () =>
          getBalanceRecipe<ledger.Utxo, ledger.UtxoOutput>({
            coins: availableCoins.map(({ utxo }) => utxo),
            initialImbalances: Imbalances.empty(),
            feeTokenType: '',
            transactionCostModel: {
              inputFeeOverhead: 0n,
              outputFeeOverhead: 0n,
            },
            createOutput: (coin) => ({
              ...coin,
              owner: wallet.publicKey.addressHex,
            }),
            isCoinEqual: (a, b) => a.intentHash === b.intentHash && a.outputNo === b.outputNo,
            targetImbalances,
          }),
        catch: (error) => {
          const message = error instanceof Error ? error.message : error?.toString() || '';
          return new TransactingError({ message });
        },
      });

      const [spentInputs, updatedWallet] = yield* CoreWallet.spendUtxos(wallet, inputs);

      const ledgerInputs = spentInputs.map((input) => ({
        ...input,
        owner: wallet.publicKey.publicKey,
      }));

      const offer = ledger.UnshieldedOffer.new(ledgerInputs, [...changeOutputs, ...ledgerOutputs], []);
      const intent = ledger.Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = offer;

      const tx = ledger.Transaction.fromParts(networkId, undefined, undefined, intent) as TTransaction;

      return {
        newState: updatedWallet,
        transaction: tx,
      };
    });
  }

  signTransaction(
    transaction: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Either.Either<ledger.UnprovenTransaction, WalletError> {
    return Either.gen(function* () {
      const segments = TransactionTrait.default.getSegments(transaction);
      if (!segments.length) {
        throw new SignError({ message: 'No segments found in the provided transaction' });
      }

      for (const segment of segments) {
        const signedData = yield* TransactionTrait.default.getOfferSignatureData(transaction, segment);
        const signature = signSegment(signedData);
        transaction = yield* TransactionTrait.default.addOfferSignature(transaction, signature, segment);
      }
      return transaction;
    });
  }
}
