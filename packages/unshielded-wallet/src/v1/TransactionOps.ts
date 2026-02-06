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
import { Either, pipe, Array as Arr } from 'effect';
import { Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { TransactingError, WalletError } from './WalletError.js';

/**
 * Unbound transaction type. This is a transaction that has no signatures and is not bound yet.
 */
export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

/**
 * Utility type to extract the Intent type from a Transaction type.
 * Maps Transaction<S, P, B> to Intent<S, P, B>.
 */
export type IntentOf<T> = T extends ledger.Transaction<infer S, infer P, infer B> ? ledger.Intent<S, P, B> : never;

export type TransactionOps = {
  getSignatureData: (
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>,
    segment: number,
  ) => Either.Either<Uint8Array, WalletError>;
  getSegments(transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>): number[];
  addSignature<TTransaction extends ledger.UnprovenTransaction | UnboundTransaction>(
    transaction: TTransaction,
    signature: ledger.Signature,
    segment: number,
  ): Either.Either<TTransaction, WalletError>;
  getImbalances(
    transaction: ledger.FinalizedTransaction | UnboundTransaction | ledger.UnprovenTransaction,
    segment: number,
  ): Imbalances;
  addSignaturesToOffer(
    offer: ledger.UnshieldedOffer<ledger.SignatureEnabled>,
    signature: ledger.Signature,
    segment: number,
    offerType: 'guaranteed' | 'fallible',
  ): Either.Either<ledger.UnshieldedOffer<ledger.SignatureEnabled>, WalletError>;
  isIntentBound(intent: ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>): boolean;
  extractOwnInputs(
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
    signatureVerifyingKey: ledger.SignatureVerifyingKey,
  ): ledger.Utxo[];
};

export const TransactionOps: TransactionOps = {
  getSignatureData(
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>,
    segment: number,
  ): Either.Either<Uint8Array, WalletError> {
    if (!tx.intents) {
      return Either.left(new TransactingError({ message: 'Transaction has no intents' }));
    }

    const intent = tx.intents.get(segment);

    if (!intent) {
      return Either.left(new TransactingError({ message: `Intent with segment ${segment} was not found` }));
    }

    return Either.try({
      try: () => intent.signatureData(segment),
      catch: (error) => new TransactingError({ message: 'Failed to get offer signature data', cause: error }),
    });
  },
  getSegments(transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>): number[] {
    return transaction.intents?.keys().toArray() ?? [];
  },
  // @TODO - https://shielded.atlassian.net/browse/PM-21260
  addSignature<TTransaction extends ledger.UnprovenTransaction | UnboundTransaction>(
    transaction: TTransaction,
    signature: ledger.Signature,
    segment: number,
  ): Either.Either<TTransaction, WalletError> {
    return Either.gen(function* () {
      if (!transaction.intents || transaction.intents.size === 0) {
        return yield* Either.left(new TransactingError({ message: 'No intents found in the transaction' }));
      }

      const intent = transaction.intents?.get(segment) as IntentOf<TTransaction> | undefined;

      if (!intent) {
        return yield* Either.left(new TransactingError({ message: `Intent with id ${segment} was not found` }));
      }

      if (TransactionOps.isIntentBound(intent)) {
        return yield* Either.left(new TransactingError({ message: `Intent at segment ${segment} is already bound` }));
      }

      if (intent.fallibleUnshieldedOffer) {
        intent.fallibleUnshieldedOffer = yield* TransactionOps.addSignaturesToOffer(
          intent.fallibleUnshieldedOffer,
          signature,
          segment,
          'fallible',
        );
      }

      if (intent.guaranteedUnshieldedOffer) {
        intent.guaranteedUnshieldedOffer = yield* TransactionOps.addSignaturesToOffer(
          intent.guaranteedUnshieldedOffer,
          signature,
          segment,
          'guaranteed',
        );
      }

      (transaction.intents as Map<number, IntentOf<TTransaction>>) = (
        transaction.intents as Map<number, IntentOf<TTransaction>>
      ).set(segment, intent);

      return transaction;
    });
  },
  getImbalances(
    transaction: ledger.FinalizedTransaction | UnboundTransaction | ledger.UnprovenTransaction,
    segment: number,
  ): Imbalances {
    const imbalances = transaction
      .imbalances(segment)
      .entries()
      .filter(([token, value]) => token.tag === 'unshielded' && value !== 0n)
      .map(([token, value]) => [(token as { tag: 'unshielded'; raw: string }).raw.toString(), value] as const)
      .toArray();

    return Imbalances.fromEntries(imbalances);
  },
  addSignaturesToOffer(
    offer: ledger.UnshieldedOffer<ledger.SignatureEnabled>,
    signature: ledger.Signature,
    segment: number,
    offerType: 'guaranteed' | 'fallible',
  ): Either.Either<ledger.UnshieldedOffer<ledger.SignatureEnabled>, WalletError> {
    return pipe(
      offer.inputs,
      Arr.map((_, i) => offer.signatures.at(i) ?? signature),
      (signatures) =>
        Either.try({
          try: () => offer.addSignatures(signatures),
          catch: (error) =>
            new TransactingError({
              message: `Failed to add ${offerType} signature at segment ${segment}`,
              cause: error,
            }),
        }),
    );
  },
  isIntentBound(intent: ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>): boolean {
    return intent.binding.instance === 'binding';
  },
  extractOwnInputs(
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
    signatureVerifyingKey: ledger.SignatureVerifyingKey,
  ): ledger.Utxo[] {
    const segments = TransactionOps.getSegments(transaction);

    return pipe(
      segments,
      Arr.flatMap((segment) => {
        const intent = transaction.intents?.get(segment);

        if (!intent) {
          return [];
        }

        const { guaranteedUnshieldedOffer, fallibleUnshieldedOffer } = intent;

        const ownedInputsfromGuaranteedSection = guaranteedUnshieldedOffer?.inputs
          ? guaranteedUnshieldedOffer.inputs.filter((input) => input.owner === signatureVerifyingKey)
          : [];

        const ownedInputsfromFallibleSection = fallibleUnshieldedOffer
          ? fallibleUnshieldedOffer.inputs.filter((input) => input.owner === signatureVerifyingKey)
          : [];

        return [...ownedInputsfromGuaranteedSection, ...ownedInputsfromFallibleSection];
      }),
    );
  },
};
