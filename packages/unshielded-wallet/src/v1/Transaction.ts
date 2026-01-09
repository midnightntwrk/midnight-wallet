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
import { Either, pipe } from 'effect';
import { Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { TransactionImbalances } from './TransactionImbalances.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { TransactingError, WalletError } from './WalletError.js';

export const isIntentBound = (
  intent: ledger.Intent<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
): boolean => {
  return intent.binding instanceof ledger.Binding;
};

export type TransactionTrait<Tx> = {
  id(tx: Tx): string;
  getOfferSignatureData: (transaction: Tx, segment: number) => Either.Either<Uint8Array, WalletError>;
  getSegments(transaction: Tx): number[];
  addOfferSignature(transaction: Tx, signature: ledger.Signature, segment: number): Either.Either<Tx, WalletError>;
  bindTransaction(
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>,
  ): Either.Either<ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Binding>, WalletError>;
};

export const TransactionTrait = new (class {
  default: TransactionTrait<ledger.UnprovenTransaction> = {
    getOfferSignatureData(tx, segment) {
      return TransactionTrait.shared.getOfferSignatureData(tx, segment);
    },
    getSegments(tx) {
      return TransactionTrait.shared.getSegments(tx);
    },
    addOfferSignature(transaction, signature, segment) {
      return TransactionTrait.shared.addOfferSignature(transaction, signature, segment);
    },
    bindTransaction(transaction) {
      return TransactionTrait.shared.bindTransaction(transaction);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };

  shared = {
    getOfferSignatureData(
      tx: ledger.UnprovenTransaction,
      segment: number,
    ): Either.Either<Uint8Array<ArrayBufferLike>, WalletError> {
      return Either.try({
        try: () => {
          if (!tx.intents) {
            throw new TransactingError({ message: 'Transaction has no intents' });
          }

          const intent = tx.intents.get(segment);

          if (!intent) {
            throw new TransactingError({ message: `Intent with segment ${segment} was not found` });
          }

          return pipe(isIntentBound(intent) ? intent : intent.bind(segment), (boundIntent) =>
            boundIntent.signatureData(segment),
          );
        },
        catch: (error) =>
          error instanceof TransactingError
            ? error
            : new TransactingError({ message: 'Failed to get offer signature data', cause: error }),
      });
    },
    addOfferSignature(
      transaction: ledger.UnprovenTransaction,
      signature: ledger.Signature,
      segment: number = 1,
    ): Either.Either<ledger.UnprovenTransaction, WalletError> {
      return Either.gen(function* () {
        if (!transaction.intents || !transaction.intents.size) {
          throw new TransactingError({ message: 'No intents found in the provided transaction' });
        }

        const intent = transaction.intents.get(segment);

        if (!intent) {
          throw new TransactingError({ message: 'Intent with a given segment was not found' });
        }

        const isBound = isIntentBound(intent);
        if (isBound) return transaction;

        let updatedIntent = intent;
        if (intent.guaranteedUnshieldedOffer) {
          const offer = intent.guaranteedUnshieldedOffer;
          const inputsLen = offer.inputs.length;
          const signatures: ledger.Signature[] = [];
          for (let i = 0; i < inputsLen; ++i) {
            signatures.push(offer.signatures.at(i) ?? signature);
          }

          updatedIntent = yield* Either.try({
            try: () => {
              const offerWithSignatures = offer.addSignatures(signatures);
              updatedIntent.guaranteedUnshieldedOffer = offerWithSignatures;
              return updatedIntent;
            },
            catch: (error) =>
              new TransactingError({
                message: `Failed to add guaranteed signature at segment ${segment}`,
                cause: error,
              }),
          });
        }

        if (intent.fallibleUnshieldedOffer) {
          const offer = intent.fallibleUnshieldedOffer;
          const inputsLen = offer.inputs.length;
          const signatures: ledger.Signature[] = [];
          for (let i = 0; i < inputsLen; ++i) {
            signatures.push(offer.signatures.at(i) ?? signature);
          }

          updatedIntent = yield* Either.try({
            try: () => {
              const offerWithSignatures = offer.addSignatures(signatures);
              updatedIntent.fallibleUnshieldedOffer = offerWithSignatures;
              return updatedIntent;
            },
            catch: (error) =>
              new TransactingError({
                message: `Failed to add fallible signature at segment ${segment}`,
                cause: error,
              }),
          });
        }

        transaction.intents = transaction.intents.set(segment, updatedIntent);

        return transaction;
      });
    },
    getSegments(transaction: ledger.UnprovenTransaction): number[] {
      return transaction.intents && transaction.intents.size > 0 ? transaction.intents.keys().toArray() : [];
    },
    bindTransaction(transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>) {
      return Either.try({
        try: () => transaction.bind(),
        catch: (error) => new TransactingError({ message: 'Failed to bind transaction', cause: error }),
      });
    },
    getImbalances(
      tx: ledger.FinalizedTransaction | ledger.UnprovenTransaction | ledger.ProofErasedTransaction,
    ): TransactionImbalances {
      const guaranteedImbalances = TransactionTrait.shared.getGuaranteedImbalances(tx);
      const fallibleImbalances = TransactionTrait.shared.getFallibleImbalances(tx);

      return pipe({
        guaranteed: guaranteedImbalances,
        fallible: fallibleImbalances,
        fees: 0n,
      });
    },
    getGuaranteedImbalances: (
      tx: ledger.FinalizedTransaction | ledger.UnprovenTransaction | ledger.ProofErasedTransaction,
    ): Imbalances => {
      const rawGuaranteedImbalances = tx
        .imbalances(0)
        .entries()
        .filter(([token]) => token.tag === 'shielded')
        .map(([token, value]) => {
          return [(token as { tag: 'shielded'; raw: string }).raw.toString(), value] as [string, bigint];
        });

      return Imbalances.fromEntries(rawGuaranteedImbalances);
    },
    getFallibleImbalances: (
      tx: ledger.FinalizedTransaction | ledger.UnprovenTransaction | ledger.ProofErasedTransaction,
    ): Imbalances => {
      try {
        const rawFallibleImbalances = tx
          .imbalances(1)
          .entries()
          .filter(([token]) => token.tag === 'shielded')
          .map(([token, value]) => {
            return [(token as { tag: 'shielded'; raw: string }).raw.toString(), value] as [string, bigint];
          });
        return Imbalances.fromEntries(rawFallibleImbalances);
      } catch {
        return Imbalances.empty();
      }
    },
  };
})();
