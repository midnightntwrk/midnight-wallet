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
import type * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps, type Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { Cause, Data, Effect, Either, Exit, Option, pipe } from 'effect';
import type { V9UnboundTransaction } from '../proving/provingService.js';

/**
 * Ledger parameters as either ledger version reads them: what a block-data fetch spanning a protocol boundary yields.
 *
 * @remarks
 *   The two ledger versions' `LedgerParameters` are structurally identical, so this union carries no information the
 *   compiler can act on — it names, at the one place a block's parameters cross into validation, that which ledger
 *   version produced them is a run-time fact settled by the block's reported protocol version. Each ledger's
 *   `LedgerState` still insists on its own class, so each ledger version's validator looks at the object it is handed
 *   and refuses the other's with a {@link LedgerParametersMismatchError}.
 */
export type AnyLedgerParameters = ledgerV8.LedgerParameters | ledgerV9.LedgerParameters;

/**
 * Snapshot of chain state required for transaction validation. Structurally identical to the dust-wallet's `BlockData`
 * — a separate declaration here keeps the validation service decoupled from dust-wallet. The two can be passed
 * interchangeably via structural typing.
 *
 * @typeParam TParameters The `LedgerParameters` type of the ledger version the parameters were decoded at. It has no
 *   default: the two ledger versions' parameters are indistinguishable to the compiler, so a default would label either
 *   ledger version's as ledger-v9's without a word of complaint.
 */
export interface BlockData<TParameters> {
  hash: string;
  height: number;
  /** The protocol version the indexer reported this block under, and so the ledger version its parameters are in. */
  protocolVersion: number;
  ledgerParameters: TParameters;
  timestamp: Date;
}

/**
 * Configurable subset of {@link ledgerV9.WellFormedStrictness}. Proof-verification flags (`verifyNativeProofs`,
 * `verifyContractProofs`) are intentionally omitted — proof verification requires the complete ledger state and will be
 * addressed in a future task.
 */
export type WellFormedStrictnessFlags = Pick<
  ledgerV9.WellFormedStrictness,
  'enforceBalancing' | 'verifySignatures' | 'enforceLimits'
>;

/**
 * @typeParam TParameters The `LedgerParameters` type of the ledger version `blockData` was decoded at — necessarily the
 *   version the validator being called speaks, since well-formedness is checked against a state built from them.
 */
export type ValidateTxOptions<TParameters> = {
  flags: WellFormedStrictnessFlags;
  blockData?: BlockData<TParameters> | undefined;
};

/** Thrown when a transaction fails the structural well-formedness check. */
export class WellFormedError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/validation/validationService/WellFormedError',
)<{
  cause: unknown;
}> {}

/** Thrown when validation cannot complete because the block-data fetch failed. */
export class ValidationFetchError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/validation/validationService/ValidationFetchError',
)<{
  cause: unknown;
}> {}

/**
 * Raised when a validator is handed block data whose parameters another ledger version decoded.
 *
 * @remarks
 *   Both ledger versions declare `LedgerParameters` identically, so nothing in the types keeps one version's out of the
 *   other's validator, and each validator looks for itself. A transaction checked against the other ledger version's
 *   parameters is not malformed, which is why this is not a {@link WellFormedError}: the block data is from the other
 *   side of `forks.v9`.
 */
export class LedgerParametersMismatchError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/validation/validationService/LedgerParametersMismatchError',
)<{
  readonly message: string;
}> {}

/** Everything a validator written against one ledger version can fail with. */
export type ValidationFailure = WellFormedError | ValidationFetchError | LedgerParametersMismatchError;

export type AnyV9ValidatableTransaction =
  ledgerV9.FinalizedTransaction | V9UnboundTransaction | ledgerV9.UnprovenTransaction;

/**
 * Checks a transaction for well-formedness.
 *
 * @typeParam TTransaction The transactions this validator accepts, and so the one ledger version it is written against.
 *   Choosing between validators for different ledger versions is {@link VersionedValidationServiceEffect}'s job, not
 *   this interface's.
 * @typeParam TParameters The `LedgerParameters` type of that same ledger version. Neither has a default: a validator
 *   that left them out would be ledger-v9's without saying so.
 */
export interface ValidationServiceEffect<TTransaction, TParameters> {
  validateTx(tx: TTransaction, options: ValidateTxOptions<TParameters>): Effect.Effect<void, ValidationFailure>;
}

export interface ValidationService<TTransaction, TParameters> {
  validateTx(tx: TTransaction, options: ValidateTxOptions<TParameters>): Promise<void>;
}

/** Raised when no validator is registered for the protocol version a transaction was authored for. */
export class UnsupportedValidationVersionError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/validation/validationService/UnsupportedValidationVersionError',
)<{
  readonly message: string;
  /** The version the transaction was authored for, which no registered validator serves. */
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
}> {}

/**
 * Checks a transaction with the validator registered for the protocol version it was authored for.
 *
 * @remarks
 *   The version is the transaction's own stamp, taken when it was authored, and never the version the chain has reached
 *   by the time it is validated. Well-formedness asks whether the ledger that produced these bytes would accept them; a
 *   fork landing between authoring and validation does not rewrite the bytes, so it cannot change the answer or who
 *   gives it.
 */
export interface VersionedValidationServiceEffect<TTransaction, TParameters> {
  validateTx(
    tx: TTransaction,
    protocolVersion: ProtocolVersion.ProtocolVersion,
    options: ValidateTxOptions<TParameters>,
  ): Effect.Effect<void, ValidationFailure | UnsupportedValidationVersionError>;
}

export interface VersionedValidationService<TTransaction, TParameters> {
  validateTx(
    tx: TTransaction,
    protocolVersion: ProtocolVersion.ProtocolVersion,
    options: ValidateTxOptions<TParameters>,
  ): Promise<void>;
}

/**
 * The validators a caller is willing to check with, keyed by the protocol version range each one serves.
 *
 * @remarks
 *   Registration is per caller, not global, and a caller registers only the ledger versions its own types are written
 *   against — the same rule the ledger-parameters codecs follow, and for the same reason: a `LedgerState` belongs to
 *   one ledger version, so a validator that speaks two would have nothing to build. A version outside every registered
 *   range therefore means "this transaction belongs to a different variant", and the router says so with
 *   {@link UnsupportedValidationVersionError} instead of handing the bytes to a checker that could only reject them.
 */
export type ValidationServices<TTransaction, TParameters> = ProtocolVersion.Registry<
  ValidationServiceEffect<TTransaction, TParameters>
>;

/**
 * Builds a validation service that routes on the version a transaction was authored for.
 *
 * @param services The validators and the version ranges they serve.
 * @returns A validation service that fails with {@link UnsupportedValidationVersionError} for a version nothing serves.
 */
export const makeVersionedValidationServiceEffect = <TTransaction, TParameters>(
  services: ValidationServices<TTransaction, TParameters>,
): VersionedValidationServiceEffect<TTransaction, TParameters> => ({
  validateTx: (tx, protocolVersion, options) =>
    Option.match(ProtocolVersion.select(services, protocolVersion), {
      onNone: () =>
        Effect.fail(
          new UnsupportedValidationVersionError({
            message: `No validator is registered for protocol version ${protocolVersion}.`,
            protocolVersion,
          }),
        ),
      onSome: (service) => service.validateTx(tx, options),
    }),
});

/**
 * Lets one validator answer for every protocol version.
 *
 * @remarks
 *   Says out loud what an unversioned validation service was implicitly claiming: that it can judge anything, whatever
 *   version authored it. True for a wallet on one side of a fork, and a lie the moment it crosses — so it has to be
 *   written down rather than assumed.
 * @param service The validator to use for every version.
 * @returns The same validator, addressed by version.
 */
export const singleVersionValidationServiceEffect = <TTransaction, TParameters>(
  service: ValidationServiceEffect<TTransaction, TParameters>,
): VersionedValidationServiceEffect<TTransaction, TParameters> => ({
  validateTx: (tx, _protocolVersion, options) => service.validateTx(tx, options),
});

export type DefaultValidationConfiguration = {
  networkId: string;
};

/**
 * @typeParam TParameters The `LedgerParameters` type of the ledger version this validator speaks, and so the version
 *   its `fetchBlockData` must decode at.
 */
export type ValidationServiceDependencies<TParameters> = {
  fetchBlockData: () => Promise<BlockData<TParameters>>;
  networkId: string;
  clock: Clock.Clock;
};

/**
 * The one thing a ledger version has to supply for its transactions to be checked: run its own well-formedness check
 * against a blank state carrying the block's parameters, throwing whatever that ledger throws.
 *
 * @remarks
 *   Deliberately allowed to throw, exactly like a {@link LedgerParametersCodec}: it wraps a WASM call whose failure mode
 *   is an exception. {@link makeValidationServiceEffect} is the only way to reach one, and it turns that into a typed
 *   {@link WellFormedError}.
 */
export type WellFormedCheck<TTransaction, TParameters> = (
  transaction: TTransaction,
  context: Readonly<{
    networkId: string;
    ledgerParameters: TParameters;
    flags: WellFormedStrictnessFlags;
    now: Date;
  }>,
) => void;

/**
 * Reads block data's parameters as the ones a ledger version's well-formedness check takes, refusing another ledger
 * version's: the two declare `LedgerParameters` identically, so only the object itself can say which made it.
 */
export type LedgerParametersReader<TParameters, TOwnParameters> = (
  parameters: TParameters,
) => Either.Either<TOwnParameters, LedgerParametersMismatchError>;

/**
 * Builds a validation service for one ledger version from that version's well-formedness check.
 *
 * @param check The ledger version's well-formedness check.
 * @param readParameters Reads block data's parameters as that ledger version's, refusing another's.
 * @param deps The network, clock, and the block-data fetcher that decodes at the same ledger version.
 * @returns A validator for that ledger version, ready to register in {@link ValidationServices}.
 */
export const makeValidationServiceEffect = <TTransaction, TParameters, TOwnParameters>(
  check: WellFormedCheck<TTransaction, TOwnParameters>,
  readParameters: LedgerParametersReader<TParameters, TOwnParameters>,
  deps: ValidationServiceDependencies<TParameters>,
): ValidationServiceEffect<TTransaction, TParameters> => ({
  validateTx(tx, options) {
    const fetchOrUse: Effect.Effect<BlockData<TParameters>, ValidationFetchError> = options.blockData
      ? Effect.succeed(options.blockData)
      : Effect.tryPromise({
          try: () => deps.fetchBlockData(),
          catch: (cause) => new ValidationFetchError({ cause }),
        });

    return pipe(
      fetchOrUse,
      Effect.flatMap((blockData) => EitherOps.toEffect(readParameters(blockData.ledgerParameters))),
      Effect.flatMap((ledgerParameters) =>
        Effect.try({
          try: () =>
            check(tx, {
              networkId: deps.networkId,
              ledgerParameters,
              flags: options.flags,
              now: deps.clock.now(),
            }),
          catch: (cause) => new WellFormedError({ cause }),
        }),
      ),
    );
  },
});

const buildStrictness = (flags: WellFormedStrictnessFlags): ledgerV9.WellFormedStrictness => {
  const strictness = new ledgerV9.WellFormedStrictness();
  strictness.enforceBalancing = flags.enforceBalancing;
  strictness.verifySignatures = flags.verifySignatures;
  strictness.enforceLimits = flags.enforceLimits;
  return strictness;
};

const buildBlankLedgerState = (networkId: string, parameters: ledgerV9.LedgerParameters): ledgerV9.LedgerState => {
  const state = ledgerV9.LedgerState.blank(networkId);
  state.parameters = parameters;
  return state;
};

/** The ledger-v9's well-formedness check. */
export const v9WellFormedCheck: WellFormedCheck<AnyV9ValidatableTransaction, ledgerV9.LedgerParameters> = (
  tx,
  { networkId, ledgerParameters, flags, now },
) => {
  tx.wellFormed(buildBlankLedgerState(networkId, ledgerParameters), buildStrictness(flags), now);
};

/**
 * Rejects a promise with the typed failure itself rather than the fiber wrapper around it, so a caller can `catch` the
 * error class the signature names.
 *
 * @remarks
 *   `E extends Error` is what makes that rejection legitimate rather than a thrown bare value, and every failure on this
 *   surface is a `Data.TaggedError`, which is one.
 */
const runPromiseThrowingFailure = async <A, E extends Error>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw new Error(Cause.pretty(exit.cause));
};

const v9LedgerParameters: LedgerParametersReader<AnyLedgerParameters, ledgerV9.LedgerParameters> = (parameters) =>
  parameters instanceof ledgerV9.LedgerParameters
    ? Either.right(parameters)
    : Either.left(
        new LedgerParametersMismatchError({
          message:
            "ledger-v9's validator was handed another ledger version's parameters; it checks transactions only against ledger-v9's.",
        }),
      );

export const makeV9ValidationServiceEffect = (
  deps: ValidationServiceDependencies<AnyLedgerParameters>,
): ValidationServiceEffect<AnyV9ValidatableTransaction, AnyLedgerParameters> =>
  makeValidationServiceEffect(v9WellFormedCheck, v9LedgerParameters, deps);

export const makeV9ValidationService = (
  deps: ValidationServiceDependencies<AnyLedgerParameters>,
): ValidationService<AnyV9ValidatableTransaction, AnyLedgerParameters> => {
  const effectService = makeV9ValidationServiceEffect(deps);
  return {
    validateTx: (tx, options) => runPromiseThrowingFailure(effectService.validateTx(tx, options)),
  };
};

/** Adapts a version-routed validation service to the promise-facing surface the facade exposes. */
export const wrapVersionedValidationService = <TTransaction, TParameters>(
  effectService: VersionedValidationServiceEffect<TTransaction, TParameters>,
): VersionedValidationService<TTransaction, TParameters> => ({
  validateTx: (tx, protocolVersion, options) =>
    runPromiseThrowingFailure(effectService.validateTx(tx, protocolVersion, options)),
});
