import { Effect, Layer, Context, Data, HashSet, pipe, Option, Either } from 'effect';
import { ParseError } from 'effect/ParseResult';
import { UnshieldedStateAPI, Utxo, UtxoNotFoundError } from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import { getBalanceRecipe, Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';
import {
  type Binding,
  type Bindingish,
  type PreBinding,
  type PreProof,
  type Proofish,
  type Signature,
  type SignatureEnabled,
  type Signaturish,
  Transaction,
  Intent,
  UnshieldedOffer,
  NetworkId,
  type RawTokenType,
  type UtxoOutput,
  type UserAddress,
} from '@midnight-ntwrk/ledger';
import { type OutputRecipe, type SerializedTransaction } from '@midnight-ntwrk/wallet-api';

interface UnshieldedToken {
  tag: 'unshielded';
  raw: RawTokenType;
}

export class DeserializationError extends Data.TaggedError('DeserializationError')<{
  readonly error?: unknown;
  readonly internal?: unknown;
}> {}

export class TransactionServiceError extends Data.TaggedError('TransactionServiceError')<{
  readonly error?: unknown;
}> {}

export interface TransactionServiceLive {
  readonly transferTransaction: (
    outputs: OutputRecipe[],
    ttl: Date,
  ) => Effect.Effect<Transaction<SignatureEnabled, PreProof, PreBinding>, TransactionServiceError>;

  readonly deserializeTransaction: <S extends Signaturish, P extends Proofish, B extends Bindingish>(
    markerS: S['instance'],
    markerP: P['instance'],
    markerB: B['instance'],
    tx: SerializedTransaction,
    networkId: NetworkId,
  ) => Effect.Effect<Transaction<S, P, B>, DeserializationError>;

  readonly serializeTransaction: (
    transaction: Transaction<Signaturish, Proofish, Bindingish>,
    networkId: NetworkId,
  ) => Effect.Effect<SerializedTransaction, TransactionServiceError>;

  readonly balanceTransaction: (
    transaction: Transaction<SignatureEnabled, PreProof, PreBinding>,
    state: UnshieldedStateAPI,
    myAddress: UserAddress,
  ) => Effect.Effect<
    Transaction<SignatureEnabled, PreProof, PreBinding>,
    TransactionServiceError | ParseError | UtxoNotFoundError
  >;

  readonly getOfferSignatureData: (
    transaction: Transaction<Signaturish, Proofish, Bindingish>,
    segment: number,
  ) => Effect.Effect<Uint8Array, TransactionServiceError>;

  readonly addOfferSignature: <S extends Signaturish, P extends Proofish, B extends Bindingish>(
    transaction: Transaction<S, P, B>,
    signature: string,
    segment: number,
  ) => Effect.Effect<Transaction<S, P, B>, TransactionServiceError>;

  readonly bindTransaction: <S extends Signaturish, P extends Proofish, B extends Bindingish>(
    transaction: Transaction<S, P, B>,
  ) => Effect.Effect<Transaction<S, P, Binding>, TransactionServiceError>;

  readonly getSegments: (transaction: Transaction<Signaturish, Proofish, Bindingish>) => number[];
}

const GUARANTEED_SEGMENT = 0;

const ledgerTry = <A>(fn: () => A): Either.Either<A, TransactionServiceError> => {
  return Either.try({
    try: fn,
    catch: (error) => {
      const message = error instanceof Error ? error.message : `${error?.toString()}`;
      return new TransactionServiceError({ error: `Error from ledger: ${message}` });
    },
  });
};

const isIntentBound = (
  intent: Intent<Signaturish, Proofish, Bindingish>,
): Either.Either<boolean, TransactionServiceError> => {
  return ledgerTry(() => !(intent.binding instanceof Uint8Array));
};

const mergeCounterOffer = (
  counterOffer: UnshieldedOffer<SignatureEnabled>,
  currentOffer?: UnshieldedOffer<SignatureEnabled>,
): Either.Either<UnshieldedOffer<SignatureEnabled>, TransactionServiceError> =>
  pipe(
    Option.fromNullable(currentOffer),
    Option.match({
      onNone: () => Either.right(counterOffer),
      onSome: (currentOffer) =>
        ledgerTry(() =>
          UnshieldedOffer.new(
            [...currentOffer.inputs, ...counterOffer.inputs],
            [...currentOffer.outputs, ...counterOffer.outputs],
            [...currentOffer.signatures, ...counterOffer.signatures],
          ),
        ),
    }),
  );

export class TransactionService extends Context.Tag('@midnight-ntwrk/wallet-sdk-unshielded-wallet/TransactionService')<
  TransactionService,
  TransactionServiceLive
>() {
  static readonly Live: Layer.Layer<TransactionService> = Layer.succeed(
    TransactionService,
    (() => {
      const transferTransaction = (
        desiredOutputs: OutputRecipe[],
        ttl: Date,
      ): Effect.Effect<Transaction<SignatureEnabled, PreProof, PreBinding>, TransactionServiceError> =>
        Effect.gen(function* () {
          const isValid = desiredOutputs.every((output) => output.amount > 0n);
          if (!isValid) {
            return yield* Effect.fail(new TransactionServiceError({ error: 'The amount needs to be positive' }));
          }

          const ledgerOutputs = desiredOutputs.map((output) => ({
            value: output.amount,
            owner: output.recipient,
            type: output.tokenType,
          }));

          return yield* ledgerTry(() => {
            const intent = Intent.new(ttl);
            intent.guaranteedUnshieldedOffer = UnshieldedOffer.new([], ledgerOutputs, []);
            return Transaction.fromParts(undefined, undefined, intent);
          });
        });

      const deserializeTransaction = <S extends Signaturish, P extends Proofish, B extends Bindingish>(
        markerS: S['instance'],
        markerP: P['instance'],
        markerB: B['instance'],
        tx: SerializedTransaction,
        networkId: NetworkId,
      ): Effect.Effect<Transaction<S, P, B>, DeserializationError> =>
        // NOTE: ledger's deserialization error is too of a low-level and doesn't tell us what exactly was wrong
        Effect.mapError(
          ledgerTry(() => {
            const data = Buffer.from(tx, 'hex');
            return Transaction.deserialize(markerS, markerP, markerB, data, networkId);
          }),
          (e) => new DeserializationError({ error: 'Unable to deserialize transaction', internal: e.error }),
        );

      const serializeTransaction = (
        transaction: Transaction<Signaturish, Proofish, Bindingish>,
        networkId: NetworkId,
      ): Effect.Effect<SerializedTransaction, TransactionServiceError> =>
        Effect.map(
          ledgerTry(() => transaction.serialize(networkId)),
          (res) => Buffer.from(res).toString('hex'),
        );

      const balanceTransaction = (
        transaction: Transaction<SignatureEnabled, PreProof, PreBinding>,
        state: UnshieldedStateAPI,
        myAddress: UserAddress,
      ): Effect.Effect<
        Transaction<SignatureEnabled, PreProof, PreBinding>,
        TransactionServiceError | ParseError | UtxoNotFoundError
      > =>
        Effect.gen(function* () {
          const segments = getSegments(transaction);
          if (!transaction.intents || !transaction.intents.size || !segments.length) {
            return yield* Effect.fail(
              new TransactionServiceError({ error: 'No intents found in the provided transaction' }),
            );
          }

          for (const segment of [...segments, GUARANTEED_SEGMENT]) {
            const allIntentImbalances = yield* ledgerTry(() => transaction.imbalances(segment));
            const imbalances = allIntentImbalances
              .entries()
              .filter(([token, _]) => token.tag === 'unshielded')
              .map(([token, value]) => {
                return [(token as UnshieldedToken).raw.toString(), value] as [string, bigint];
              })
              .toArray();

            // intent is balanced
            if (!imbalances.length) continue;

            const latestState = yield* state.getLatestState();
            const availableCoins = HashSet.toValues(latestState.utxos);

            // select inputs, receive the change outputs
            const { inputs, outputs: changeOutputs } = yield* Effect.try({
              try: () =>
                getBalanceRecipe<Utxo, UtxoOutput>({
                  coins: availableCoins,
                  initialImbalances: Imbalances.fromEntries(imbalances),
                  feeTokenType: '',
                  transactionCostModel: {
                    inputFeeOverhead: 0n,
                    outputFeeOverhead: 0n,
                  },
                  createOutput: (coin) => ({
                    ...coin,
                    owner: myAddress,
                  }),
                  isCoinEqual: (a, b) => a.intentHash === b.intentHash && a.outputNo === b.outputNo,
                }),
              catch: (error) => {
                const message = error instanceof Error ? error.message : error?.toString();
                return new TransactionServiceError({ error: message });
              },
            });

            if (!inputs.length) {
              return yield* Effect.fail(new TransactionServiceError({ error: 'No coins found to spend' }));
            }

            // mark the coins as spent
            for (const input of inputs) {
              yield* state.spend(input);
            }

            const counterOffer = yield* ledgerTry(() => UnshieldedOffer.new(inputs, changeOutputs, []));

            // NOTE: for the segment === 0 we insert the counter-offer into any intent's guaranteed section
            if (segment !== GUARANTEED_SEGMENT) {
              const intent: Intent<SignatureEnabled, PreProof, PreBinding> = transaction.intents.get(segment)!;
              const isBound = yield* isIntentBound(intent);
              if (!isBound) {
                const mergedOffer = yield* mergeCounterOffer(counterOffer, intent.fallibleUnshieldedOffer);
                yield* ledgerTry(() => {
                  intent.fallibleUnshieldedOffer = mergedOffer;
                  transaction.intents = transaction.intents!.set(segment, intent);
                });
              } else {
                // create a new offer if the intent is bound
                yield* ledgerTry(() => {
                  const nextSegment = Math.max(...getSegments(transaction)) + 1;
                  const newIntent = Intent.new(intent.ttl);
                  newIntent.fallibleUnshieldedOffer = counterOffer;
                  transaction.intents = transaction.intents!.set(nextSegment, newIntent);
                });
              }
            } else {
              let ttl = new Date();
              let updated = false;

              // try to find and modify any unbound intent first
              const segments = getSegments(transaction);
              for (const segment of segments) {
                const intent = transaction.intents.get(segment)!;
                ttl = intent.ttl;
                const isBound = yield* isIntentBound(intent);

                if (!isBound) {
                  const mergedOffer = yield* mergeCounterOffer(counterOffer, intent.guaranteedUnshieldedOffer);
                  yield* ledgerTry(() => {
                    intent.guaranteedUnshieldedOffer = mergedOffer;
                    transaction.intents = transaction.intents!.set(segment, intent);
                  });
                  updated = true;
                  break;
                }
              }

              // no unbound intents found, insert a new one
              if (!updated) {
                yield* ledgerTry(() => {
                  const nextSegment = Math.max(...segments) + 1;
                  const newIntent = Intent.new(ttl);
                  newIntent.guaranteedUnshieldedOffer = counterOffer;
                  transaction.intents = transaction.intents!.set(nextSegment, newIntent);
                });
              }
            }
          }
          return transaction;
        });

      const getOfferSignatureData = (
        transaction: Transaction<Signaturish, Proofish, Bindingish>,
        segment: number = 1,
      ): Effect.Effect<Uint8Array, TransactionServiceError> => {
        if (!transaction.intents) {
          return Effect.fail(new TransactionServiceError({ error: 'No intents found in the provided transaction' }));
        }

        const intent = transaction.intents.get(segment);
        if (!intent) {
          return Effect.fail(new TransactionServiceError({ error: 'Intent with a given segment was not found' }));
        }

        return pipe(
          ledgerTry(() => intent.bind(segment)),
          Effect.andThen((boundIntent) => ledgerTry(() => boundIntent.signatureData(segment))),
        );
      };

      const addOfferSignature = <S extends Signaturish, P extends Proofish, B extends Bindingish>(
        transaction: Transaction<S, P, B>,
        signature: Signature,
        segment: number = 1,
      ): Effect.Effect<Transaction<S, P, B>, TransactionServiceError> =>
        Effect.gen(function* () {
          if (!transaction.intents || !transaction.intents.size) {
            return yield* Effect.fail(
              new TransactionServiceError({ error: 'No intents found in the provided transaction' }),
            );
          }

          const intent = transaction.intents.get(segment);
          if (!intent) {
            return yield* Effect.fail(
              new TransactionServiceError({ error: 'Intent with a given segment was not found' }),
            );
          }

          // skip if it's locked
          const isBound = yield* isIntentBound(intent);
          if (isBound) return transaction;

          let updatedIntent = intent;
          if (intent.guaranteedUnshieldedOffer) {
            const offer = intent.guaranteedUnshieldedOffer;
            const inputsLen = offer.inputs.length;
            const signatures: Signature[] = [];
            for (let i = 0; i < inputsLen; ++i) {
              signatures.push(offer.signatures.at(i) ?? signature);
            }
            const updatedOffer = yield* ledgerTry(() => offer.addSignatures(signatures));
            updatedIntent = yield* ledgerTry(() => {
              updatedIntent.guaranteedUnshieldedOffer = updatedOffer;
              return updatedIntent;
            });
          }

          if (intent.fallibleUnshieldedOffer) {
            const offer = intent.fallibleUnshieldedOffer;
            const inputsLen = offer.inputs.length;
            const signatures: Signature[] = [];
            for (let i = 0; i < inputsLen; ++i) {
              signatures.push(offer.signatures.at(i) ?? signature);
            }
            const updatedOffer = yield* ledgerTry(() => offer.addSignatures(signatures));
            updatedIntent = yield* ledgerTry(() => {
              updatedIntent.fallibleUnshieldedOffer = updatedOffer;
              return updatedIntent;
            });
          }

          transaction.intents = yield* ledgerTry(() => transaction.intents!.set(segment, updatedIntent));

          return transaction;
        });

      const bindTransaction = <S extends Signaturish, P extends Proofish, B extends Bindingish>(
        transaction: Transaction<S, P, B>,
      ) => ledgerTry(() => transaction.bind());

      const getSegments = (transaction: Transaction<Signaturish, Proofish, Bindingish>): number[] => {
        return transaction.intents ? [...transaction.intents.keys()] : [];
      };

      return TransactionService.of({
        transferTransaction,
        deserializeTransaction,
        serializeTransaction,
        balanceTransaction,
        getOfferSignatureData,
        addOfferSignature,
        bindTransaction,
        getSegments,
      });
    })(),
  );
}
