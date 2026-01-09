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

export type BoundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>;
export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

export type TransactingTrait = {
  getSignatureData: (
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>,
    segment: number,
  ) => Either.Either<Uint8Array, WalletError>;
  getSegments(transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>): number[];
  addSignature(
    transaction: ledger.UnprovenTransaction,
    signature: ledger.Signature,
    segment: number,
  ): Either.Either<ledger.UnprovenTransaction, WalletError>;
  bind(transaction: UnboundTransaction): Either.Either<BoundTransaction, WalletError>;
  getImbalances(transaction: BoundTransaction | UnboundTransaction, segment: number): Imbalances;
  addSignaturesToOffer(
    offer: ledger.UnshieldedOffer<ledger.SignatureEnabled>,
    signature: ledger.Signature,
    segment: number,
    offerType: 'guaranteed' | 'fallible',
  ): Either.Either<ledger.UnshieldedOffer<ledger.SignatureEnabled>, WalletError>;
  isIntentBound(intent: ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>): boolean;
};

export const TransactingTrait: TransactingTrait = {
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
  getSegments(transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>): number[] {
    return transaction.intents?.keys().toArray() ?? [];
  },
  addSignature(
    transaction: ledger.UnprovenTransaction,
    signature: ledger.Signature,
    segment: number,
  ): Either.Either<ledger.UnprovenTransaction, WalletError> {
    return Either.gen(function* () {
      if (!transaction.intents || transaction.intents.size === 0) {
        return yield* Either.left(new TransactingError({ message: 'No intents found in the transaction' }));
      }

      const originalIntent = yield* Either.fromNullable(
        transaction.intents?.get(segment),
        () => new TransactingError({ message: 'Intent with a given segment was not found' }),
      );

      if (TransactingTrait.isIntentBound(originalIntent)) {
        return yield* Either.left(new TransactingError({ message: `Intent at segment ${segment} is already bound` }));
      }

      const clonedIntent = yield* Either.try({
        try: () =>
          ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>(
            'signature',
            'pre-proof',
            'pre-binding',
            originalIntent.serialize(),
          ),
        catch: (error) => new TransactingError({ message: 'Failed to clone intent', cause: error }),
      });

      if (clonedIntent.fallibleUnshieldedOffer) {
        clonedIntent.fallibleUnshieldedOffer = yield* TransactingTrait.addSignaturesToOffer(
          clonedIntent.fallibleUnshieldedOffer,
          signature,
          segment,
          'fallible',
        );
      }

      if (clonedIntent.guaranteedUnshieldedOffer) {
        clonedIntent.guaranteedUnshieldedOffer = yield* TransactingTrait.addSignaturesToOffer(
          clonedIntent.guaranteedUnshieldedOffer,
          signature,
          segment,
          'guaranteed',
        );
      }

      transaction.intents = transaction.intents?.set(segment, clonedIntent);

      return transaction;
    });
  },
  getImbalances(transaction: BoundTransaction | UnboundTransaction, segment: number): Imbalances {
    const imbalances = transaction
      .imbalances(segment)
      .entries()
      .filter(([token, value]) => token.tag === 'unshielded' && value !== 0n)
      .map(([token, value]) => [token, value] as [ledger.UnshieldedTokenType, bigint])
      .map(([token, value]) => [token.raw, value] as [string, bigint])
      .toArray();

    return Imbalances.fromEntries(imbalances);
  },
  bind(transaction: UnboundTransaction): Either.Either<BoundTransaction, WalletError> {
    return Either.try({
      try: () => transaction.bind(),
      catch: (error) => new TransactingError({ message: 'Failed to bind transaction', cause: error }),
    });
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
    return intent.binding instanceof ledger.Binding;
  },
};
