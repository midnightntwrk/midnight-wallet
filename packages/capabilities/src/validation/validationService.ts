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
import * as ledger from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import type { Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { Cause, Data, Effect, Exit, Option, pipe } from 'effect';
import type { UnboundTransaction } from '../proving/provingService.js';

/**
 * Snapshot of chain state required for transaction validation. Structurally identical to the dust-wallet's `BlockData`
 * — a separate declaration here keeps the validation service decoupled from dust-wallet. The two can be passed
 * interchangeably via structural typing.
 *
 * @typeParam TParameters The `LedgerParameters` type of the ledger version the parameters were decoded at. Defaults to
 *   the current ledger's, so `BlockData` unqualified still names exactly what it always did.
 */
export interface BlockData<TParameters = ledger.LedgerParameters> {
  hash: string;
  height: number;
  /** The protocol version the indexer reported this block under, and so the ledger version its parameters are in. */
  protocolVersion: number;
  ledgerParameters: TParameters;
  timestamp: Date;
}

/**
 * Configurable subset of {@link ledger.WellFormedStrictness}. Proof-verification flags (`verifyNativeProofs`,
 * `verifyContractProofs`) are intentionally omitted — proof verification requires the complete ledger state and will be
 * addressed in a future task.
 */
export type WellFormedStrictnessFlags = Pick<
  ledger.WellFormedStrictness,
  'enforceBalancing' | 'verifySignatures' | 'enforceLimits'
>;

/**
 * @typeParam TParameters The `LedgerParameters` type of the ledger version `blockData` was decoded at — necessarily the
 *   version the validator being called speaks, since well-formedness is checked against a state built from them.
 */
export type ValidateTxOptions<TParameters = ledger.LedgerParameters> = {
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

export type AnyValidatableTransaction = ledger.FinalizedTransaction | UnboundTransaction | ledger.UnprovenTransaction;

/**
 * Checks a transaction for well-formedness.
 *
 * @typeParam TTransaction The transactions this validator accepts. Defaults to the current ledger's, because a
 *   validator is only ever written against one ledger version — which is exactly why choosing between validators is
 *   {@link VersionedValidationServiceEffect}'s job and not this interface's.
 * @typeParam TParameters The `LedgerParameters` type of that same ledger version.
 */
export interface ValidationServiceEffect<
  TTransaction = AnyValidatableTransaction,
  TParameters = ledger.LedgerParameters,
> {
  validateTx(
    tx: TTransaction,
    options: ValidateTxOptions<TParameters>,
  ): Effect.Effect<void, WellFormedError | ValidationFetchError>;
}

export interface ValidationService<TTransaction = AnyValidatableTransaction, TParameters = ledger.LedgerParameters> {
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
export interface VersionedValidationServiceEffect<
  TTransaction = AnyValidatableTransaction,
  TParameters = ledger.LedgerParameters,
> {
  validateTx(
    tx: TTransaction,
    protocolVersion: ProtocolVersion.ProtocolVersion,
    options: ValidateTxOptions<TParameters>,
  ): Effect.Effect<void, WellFormedError | ValidationFetchError | UnsupportedValidationVersionError>;
}

export interface VersionedValidationService<
  TTransaction = AnyValidatableTransaction,
  TParameters = ledger.LedgerParameters,
> {
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
export type ValidationServices<
  TTransaction = AnyValidatableTransaction,
  TParameters = ledger.LedgerParameters,
> = ProtocolVersion.Registry<ValidationServiceEffect<TTransaction, TParameters>>;

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
export type ValidationServiceDependencies<TParameters = ledger.LedgerParameters> = {
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
 * Builds a validation service for one ledger version from that version's well-formedness check.
 *
 * @param check The ledger version's well-formedness check.
 * @param deps The network, clock, and the block-data fetcher that decodes at the same ledger version.
 * @returns A validator for that ledger version, ready to register in {@link ValidationServices}.
 */
export const makeValidationServiceEffect = <TTransaction, TParameters>(
  check: WellFormedCheck<TTransaction, TParameters>,
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
      Effect.flatMap((blockData) =>
        Effect.try({
          try: () =>
            check(tx, {
              networkId: deps.networkId,
              ledgerParameters: blockData.ledgerParameters,
              flags: options.flags,
              now: deps.clock.now(),
            }),
          catch: (cause) => new WellFormedError({ cause }),
        }),
      ),
    );
  },
});

const buildStrictness = (flags: WellFormedStrictnessFlags): ledger.WellFormedStrictness => {
  const strictness = new ledger.WellFormedStrictness();
  strictness.enforceBalancing = flags.enforceBalancing;
  strictness.verifySignatures = flags.verifySignatures;
  strictness.enforceLimits = flags.enforceLimits;
  return strictness;
};

const buildBlankLedgerState = (networkId: string, parameters: ledger.LedgerParameters): ledger.LedgerState => {
  const state = ledger.LedgerState.blank(networkId);
  state.parameters = parameters;
  return state;
};

/** The current ledger version's well-formedness check. */
export const currentLedgerWellFormedCheck: WellFormedCheck<AnyValidatableTransaction, ledger.LedgerParameters> = (
  tx,
  { networkId, ledgerParameters, flags, now },
) => {
  tx.wellFormed(buildBlankLedgerState(networkId, ledgerParameters), buildStrictness(flags), now);
};

/**
 * Rejects a promise with the typed failure itself rather than the fiber wrapper around it, so a caller can `catch` the
 * error class the signature names.
 */
const runPromiseThrowingFailure = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw new Error(Cause.pretty(exit.cause));
};

export const makeDefaultValidationServiceEffect = (deps: ValidationServiceDependencies): ValidationServiceEffect =>
  makeValidationServiceEffect(currentLedgerWellFormedCheck, deps);

export const makeDefaultValidationService = (deps: ValidationServiceDependencies): ValidationService => {
  const effectService = makeDefaultValidationServiceEffect(deps);
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
