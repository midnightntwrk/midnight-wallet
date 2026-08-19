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
import { Either, type Option, pipe, Array as Arr, Iterable as IterableOps } from 'effect';
import { Imbalances } from '@midnightntwrk/wallet-sdk-capabilities';
import type * as ledger from '@midnightntwrk/ledger-v9';
import { addressFromKey, SignatureEnabled } from '@midnightntwrk/ledger-v9';
import { assertSignatureMatchesKey } from '../SchemeConsistency.js';
import { TransactingError, type WalletError } from './WalletError.js';

/** Unbound transaction type. This is a transaction that has no signatures and is not bound yet. */
export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

/** Utility type to extract the Intent type from a Transaction type. Maps Transaction<S, P, B> to Intent<S, P, B>. */
export type IntentOf<T> = T extends ledger.Transaction<infer S, infer P, infer B> ? ledger.Intent<S, P, B> : never;

/** A transaction segment paired with the bytes that must be signed to authorize it. */
export type SignableSegment = { readonly segment: number; readonly data: Uint8Array };

/** A signature produced for a specific transaction segment, ready to be attached. */
export type SegmentSignature = { readonly segment: number; readonly signature: ledger.Signature };

/**
 * Asserts that `signature` shares the scheme of every input owner authorized in `segment`. Pure and synchronous: a
 * mismatch short-circuits with a typed `SchemeMismatchError` so a wrong-scheme signature is never attached.
 */
const assertSignatureMatchesSegmentOwners = (
  transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  segment: number,
  signature: ledger.Signature,
): Either.Either<ledger.Signature, WalletError> => {
  const intent = transaction.intents?.get(segment);
  const owners = [
    ...(intent?.guaranteedUnshieldedOffer?.inputs ?? []),
    ...(intent?.fallibleUnshieldedOffer?.inputs ?? []),
  ].map((input) => input.owner);
  const seed: Either.Either<ledger.Signature, WalletError> = Either.right(signature);
  return pipe(
    owners,
    Arr.reduce(seed, (acc, owner) => Either.flatMap(acc, () => assertSignatureMatchesKey(owner, signature))),
  );
};

export type TransactionOps = {
  getSignatureData: (
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>,
    segment: number,
  ) => Either.Either<Uint8Array, WalletError>;
  getSegments(transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>): number[];
  findAvailableSegmentId(
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  ): Option.Option<number>;
  addSignature<TTransaction extends ledger.UnprovenTransaction | UnboundTransaction>(
    transaction: TTransaction,
    signature: ledger.Signature,
    segment: number,
  ): Either.Either<TTransaction, WalletError>;
  collectSignableData(
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>,
  ): Either.Either<readonly SignableSegment[], WalletError>;
  attachSignatures<TTransaction extends ledger.UnprovenTransaction | UnboundTransaction>(
    transaction: TTransaction,
    signatures: readonly SegmentSignature[],
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
  findAvailableSegmentId(
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  ): Option.Option<number> {
    const used = new Set(transaction.intents?.keys() ?? []);
    return pipe(
      IterableOps.range(1, 65535),
      IterableOps.findFirst((segmentId) => !used.has(segmentId)),
    );
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
  collectSignableData(
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>,
  ): Either.Either<readonly SignableSegment[], WalletError> {
    // A transaction with no intents has no signable segments — yields an empty list, never an error.
    return Either.all(
      TransactionOps.getSegments(transaction).map((segment) =>
        Either.map(TransactionOps.getSignatureData(transaction, segment), (data) => ({ segment, data })),
      ),
    );
  },
  attachSignatures<TTransaction extends ledger.UnprovenTransaction | UnboundTransaction>(
    transaction: TTransaction,
    signatures: readonly SegmentSignature[],
  ): Either.Either<TTransaction, WalletError> {
    return Either.gen(function* () {
      // Validate every signature's scheme against its segment's owners BEFORE attaching any of them, so a
      // mismatch leaves the transaction untouched (no partially-signed transaction can escape toward the network).
      yield* Either.all(
        signatures.map(({ segment, signature }) =>
          assertSignatureMatchesSegmentOwners(transaction, segment, signature),
        ),
      );
      const seed: Either.Either<TTransaction, WalletError> = Either.right(transaction);
      return yield* pipe(
        signatures,
        Arr.reduce(seed, (acc, { segment, signature }) =>
          Either.flatMap(acc, (tx) => TransactionOps.addSignature(tx, signature, segment)),
        ),
      );
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
      Arr.map((_, i) => offer.signatures.at(i) ?? new SignatureEnabled(signature)),
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
    const ownerAddress = addressFromKey(signatureVerifyingKey);
    const isOwn = (input: ledger.UtxoSpend): boolean =>
      input.owner.tag === signatureVerifyingKey.tag && input.owner.value === signatureVerifyingKey.value;
    // Intent inputs are UtxoSpends owned by a verifying key; a Utxo is owned by the derived address
    const toUtxo = (input: ledger.UtxoSpend): ledger.Utxo => ({ ...input, owner: ownerAddress });

    return pipe(
      segments,
      Arr.flatMap((segment) => {
        const intent = transaction.intents?.get(segment);

        if (!intent) {
          return [];
        }

        const { guaranteedUnshieldedOffer, fallibleUnshieldedOffer } = intent;

        const ownedInputsfromGuaranteedSection = guaranteedUnshieldedOffer?.inputs
          ? guaranteedUnshieldedOffer.inputs.filter(isOwn)
          : [];

        const ownedInputsfromFallibleSection = fallibleUnshieldedOffer
          ? fallibleUnshieldedOffer.inputs.filter(isOwn)
          : [];

        return [...ownedInputsfromGuaranteedSection, ...ownedInputsfromFallibleSection].map(toUtxo);
      }),
    );
  },
};
