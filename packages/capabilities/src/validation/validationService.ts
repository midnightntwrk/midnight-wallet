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
import type { Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { Cause, Data, Effect, Exit, Option, pipe } from 'effect';
import type { UnboundTransaction } from '../proving/provingService.js';

/**
 * Snapshot of chain state required for transaction validation. Structurally identical to the dust-wallet's `BlockData`
 * — a separate declaration here keeps the validation service decoupled from dust-wallet. The two can be passed
 * interchangeably via structural typing.
 */
export interface BlockData {
  hash: string;
  height: number;
  ledgerParameters: ledger.LedgerParameters;
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

export type ValidateTxOptions = {
  flags: WellFormedStrictnessFlags;
  blockData?: BlockData | undefined;
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

export interface ValidationServiceEffect {
  validateTx(
    tx: AnyValidatableTransaction,
    options: ValidateTxOptions,
  ): Effect.Effect<void, WellFormedError | ValidationFetchError>;
}

export interface ValidationService {
  validateTx(tx: AnyValidatableTransaction, options: ValidateTxOptions): Promise<void>;
}

export type DefaultValidationConfiguration = {
  networkId: string;
};

export type ValidationServiceDependencies = {
  fetchBlockData: () => Promise<BlockData>;
  networkId: string;
  clock: Clock.Clock;
};

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

export const makeDefaultValidationServiceEffect = (deps: ValidationServiceDependencies): ValidationServiceEffect => ({
  validateTx(tx, options) {
    const fetchOrUse: Effect.Effect<BlockData, ValidationFetchError> = options.blockData
      ? Effect.succeed(options.blockData)
      : Effect.tryPromise({
          try: () => deps.fetchBlockData(),
          catch: (cause) => new ValidationFetchError({ cause }),
        });

    return pipe(
      fetchOrUse,
      Effect.flatMap((blockData) =>
        Effect.try({
          try: () => {
            const ledgerState = buildBlankLedgerState(deps.networkId, blockData.ledgerParameters);
            const strictness = buildStrictness(options.flags);
            tx.wellFormed(ledgerState, strictness, deps.clock.now());
          },
          catch: (cause) => new WellFormedError({ cause }),
        }),
      ),
    );
  },
});

export const makeDefaultValidationService = (deps: ValidationServiceDependencies): ValidationService => {
  const effectService = makeDefaultValidationServiceEffect(deps);
  return {
    validateTx: async (tx, options) => {
      const exit = await Effect.runPromiseExit(effectService.validateTx(tx, options));
      if (Exit.isSuccess(exit)) return;
      const failure = Cause.failureOption(exit.cause);
      if (Option.isSome(failure)) throw failure.value;
      throw new Error(Cause.pretty(exit.cause));
    },
  };
};
