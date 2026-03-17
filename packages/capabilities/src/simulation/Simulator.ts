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

/**
 * Unified Simulator for wallet testing.
 *
 * This module provides a simulated ledger environment for testing wallet functionality
 * without requiring a real blockchain node. It supports:
 * - Blank state initialization (for dust/Night token testing)
 * - Genesis mints initialization (for shielded/unshielded token testing)
 * - Transaction submission with configurable strictness
 * - Night token rewards (for dust testing)
 * - Time advancement (for TTL and time-sensitive tests)
 */

import { Array as Arr, Clock, Effect, type Either, Encoding, pipe, type Scope, Stream, SubscriptionRef } from 'effect';
import {
  LedgerState,
  type BlockContext,
  type UserAddress,
  ClaimRewardsTransaction,
  SignatureErased,
  type SignatureVerifyingKey,
  Transaction,
  WellFormedStrictness,
  type TransactionResult,
  TransactionContext,
  type ProofErasedTransaction,
  type SyntheticCost,
  type RawTokenType,
  type ZswapSecretKeys,
  createShieldedCoinInfo,
  ZswapOutput,
  ZswapOffer,
  type PreProof,
} from '@midnight-ntwrk/ledger-v8';
import { DateOps, EitherOps, LedgerOps, ArrayOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as crypto from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Simulator state containing the ledger and transaction history.
 */
export type SimulatorState = Readonly<{
  networkId: NetworkId.NetworkId;
  ledger: LedgerState;
  lastTx: ProofErasedTransaction | undefined;
  lastTxResult: TransactionResult | undefined;
  lastTxNumber: bigint;
}>;

/**
 * Result of a successful transaction submission.
 */
export type BlockInfo = Readonly<{
  blockNumber: bigint;
  blockHash: string;
}>;

/**
 * Genesis mint specification for initializing the simulator with pre-funded accounts.
 */
export type GenesisMint = Readonly<{
  amount: bigint;
  type: RawTokenType;
  recipient: ZswapSecretKeys;
}>;

/**
 * Configuration for well-formedness strictness checks.
 * All options default to false for testing flexibility.
 */
export type StrictnessConfig = Readonly<{
  enforceBalancing?: boolean;
  verifyNativeProofs?: boolean;
  verifyContractProofs?: boolean;
  enforceLimits?: boolean;
  verifySignatures?: boolean;
}>;

/**
 * Simulator initialization configuration.
 */
export type SimulatorConfig =
  | { readonly mode: 'blank'; readonly networkId: NetworkId.NetworkId }
  | {
      readonly mode: 'genesis';
      readonly genesisMints: Arr.NonEmptyArray<GenesisMint>;
      readonly networkId?: NetworkId.NetworkId;
    };

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Ensure hex string has even length by padding with leading zero if needed.
 * Required for proper hex decoding.
 */
const padHexToEvenLength = (hex: string): string => (hex.length % 2 === 0 ? hex : hex.padStart(hex.length + 1, '0'));

/**
 * Compute SHA-256 hash of a hex string.
 */
const simpleHash = (input: string): Effect.Effect<string> =>
  Encoding.decodeHex(input).pipe(
    EitherOps.toEffect,
    Effect.andThen((parsed) =>
      Effect.promise(() => crypto.subtle.digest('SHA-256', parsed as Uint8Array<ArrayBuffer>)),
    ),
    Effect.andThen((out) => Encoding.encodeHex(new Uint8Array(out))),
    Effect.orDie,
  );

/**
 * Create a WellFormedStrictness instance with configurable options.
 * All options default to false for maximum testing flexibility.
 *
 * Note: WellFormedStrictness is a class from the ledger library that requires
 * mutation to configure. This is unavoidable given the external API design.
 */
const createStrictness = (config: StrictnessConfig = {}): WellFormedStrictness => {
  const strictness = new WellFormedStrictness();
  strictness.enforceBalancing = config.enforceBalancing ?? false;
  strictness.verifyNativeProofs = config.verifyNativeProofs ?? false;
  strictness.verifyContractProofs = config.verifyContractProofs ?? false;
  strictness.enforceLimits = config.enforceLimits ?? false;
  strictness.verifySignatures = config.verifySignatures ?? false;
  return strictness;
};

/**
 * Create a Simulator from an initial state with proper stream setup.
 */
const createSimulatorFromState = (initialState: SimulatorState): Effect.Effect<Simulator, never, Scope.Scope> =>
  Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make<SimulatorState>(initialState);
    const changesStream = yield* Stream.share(ref.changes, {
      capacity: 'unbounded',
      replay: Number.MAX_SAFE_INTEGER,
    });
    yield* pipe(changesStream, Stream.runDrain, Effect.forkScoped);
    return new Simulator(ref, changesStream);
  });

// =============================================================================
// Simulator Class
// =============================================================================

/**
 * Unified simulator for wallet testing.
 *
 * Provides a simulated ledger environment that can be initialized in two modes:
 * - **Blank mode**: Empty ledger state, useful for dust/Night token testing
 * - **Genesis mode**: Pre-funded accounts via genesis mints, useful for token transfer testing
 *
 * @example
 * ```typescript
 * // Blank mode for dust testing
 * const simulator = yield* Simulator.init({ mode: 'blank', networkId: NetworkId.Undeployed });
 *
 * // Genesis mode for token transfer testing
 * const simulator = yield* Simulator.init({
 *   mode: 'genesis',
 *   genesisMints: [{ amount: 1000n, type: tokenType, recipient: secretKeys }],
 * });
 * ```
 */
export class Simulator {
  // ===========================================================================
  // Static Methods
  // ===========================================================================

  /**
   * Compute block hash from block time.
   */
  static blockHash = (blockTime: Date): Effect.Effect<string> =>
    pipe(DateOps.dateToSeconds(blockTime).toString(16), padHexToEvenLength, simpleHash);

  /**
   * Create the next block context from block time.
   */
  static nextBlockContext = (blockTime: Date): Effect.Effect<BlockContext> =>
    pipe(
      Simulator.blockHash(blockTime),
      Effect.map((hash) => ({
        parentBlockHash: hash,
        secondsSinceEpoch: DateOps.dateToSeconds(blockTime),
        secondsSinceEpochErr: 1,
        lastBlockTime: 1n,
      })),
    );

  /**
   * Create the next block context from block number (for genesis mode).
   */
  static nextBlockContextFromNumber = (number: bigint): Effect.Effect<BlockContext> =>
    pipe(number.toString(16), padHexToEvenLength, simpleHash, (hashEffect) =>
      Effect.map(hashEffect, (hash) => ({
        parentBlockHash: hash,
        secondsSinceEpoch: number,
        secondsSinceEpochErr: 1,
        lastBlockTime: 1n,
      })),
    );

  /**
   * Pure state transition: apply a transaction to the simulator state.
   * Returns Either with the new state or an error.
   */
  static apply(
    simulatorState: SimulatorState,
    tx: ProofErasedTransaction,
    strictness: WellFormedStrictness,
    blockContext: BlockContext,
    blockFullness?: SyntheticCost,
  ): Either.Either<[BlockInfo, SimulatorState], LedgerOps.LedgerError> {
    return LedgerOps.ledgerTry(() => {
      const computedFullness = blockFullness ?? tx.cost(simulatorState.ledger.parameters);

      const detailedBlockFullness = simulatorState.ledger.parameters.normalizeFullness(computedFullness);
      const computedBlockFullness = Math.max(
        detailedBlockFullness.readTime,
        detailedBlockFullness.computeTime,
        detailedBlockFullness.blockUsage,
        detailedBlockFullness.bytesWritten,
        detailedBlockFullness.bytesChurned,
      );

      const blockNumber = blockContext.secondsSinceEpoch;
      const blockTime = DateOps.secondsToDate(blockNumber);
      const verifiedTransaction = tx.wellFormed(simulatorState.ledger, strictness, blockTime);
      const transactionContext = new TransactionContext(simulatorState.ledger, blockContext);
      const [newLedgerState, txResult] = simulatorState.ledger.apply(verifiedTransaction, transactionContext);

      const newSimulatorState: SimulatorState = {
        ...simulatorState,
        ledger: newLedgerState.postBlockUpdate(blockTime, detailedBlockFullness, computedBlockFullness),
        lastTx: tx,
        lastTxResult: txResult,
        lastTxNumber: blockNumber,
      };

      const output: BlockInfo = {
        blockNumber,
        blockHash: blockContext.parentBlockHash,
      };

      return [output, newSimulatorState];
    });
  }

  /**
   * Initialize a new simulator.
   *
   * @param config - Configuration specifying initialization mode
   * @returns Effect that produces a Simulator instance
   */
  static init(config: SimulatorConfig): Effect.Effect<Simulator, never, Scope.Scope> {
    return config.mode === 'blank'
      ? Simulator.initBlank(config.networkId)
      : Simulator.initWithGenesis(config.genesisMints, config.networkId);
  }

  /**
   * Initialize simulator with blank ledger state.
   */
  private static initBlank(networkId: NetworkId.NetworkId): Effect.Effect<Simulator, never, Scope.Scope> {
    const initialState: SimulatorState = {
      networkId,
      ledger: LedgerState.blank(networkId),
      lastTx: undefined,
      lastTxResult: undefined,
      lastTxNumber: 0n,
    };
    return createSimulatorFromState(initialState);
  }

  /**
   * Initialize simulator with genesis mints (pre-funded accounts).
   */
  private static initWithGenesis(
    genesisMints: Arr.NonEmptyArray<GenesisMint>,
    networkId: NetworkId.NetworkId = NetworkId.NetworkId.Undeployed,
  ): Effect.Effect<Simulator, never, Scope.Scope> {
    const emptyState = LedgerState.blank(networkId);
    const noStrictness = createStrictness();

    const makeTransactions = (context: BlockContext) =>
      Effect.gen(function* () {
        const nowMillis = yield* Clock.currentTimeMillis;
        const verificationTime = new Date(nowMillis);

        const tx = pipe(
          genesisMints,
          Arr.map((transfer) => {
            const coin = createShieldedCoinInfo(transfer.type, transfer.amount);
            const output = ZswapOutput.new(
              coin,
              0,
              transfer.recipient.coinPublicKey,
              transfer.recipient.encryptionPublicKey,
            );
            return ZswapOffer.fromOutput<PreProof>(output, transfer.type, transfer.amount);
          }),
          ArrayOps.fold((acc, offer) => acc.merge(offer)),
          (offer) => Transaction.fromParts(networkId, offer).eraseProofs(),
          (tx) => tx.wellFormed(emptyState, noStrictness, verificationTime),
        );

        const [initialState, initialResult] = emptyState.apply(tx, new TransactionContext(emptyState, context));
        const postBlockUpdateState = initialState.postBlockUpdate(verificationTime);

        return {
          initialResult,
          initialState: postBlockUpdateState,
          tx,
        } as const;
      });

    return Effect.gen(function* () {
      const context = yield* Simulator.nextBlockContextFromNumber(0n);
      const init = yield* makeTransactions(context);
      const initialState: SimulatorState = {
        networkId,
        ledger: init.initialState,
        lastTx: undefined, // Genesis tx is not tracked (already verified)
        lastTxResult: init.initialResult,
        lastTxNumber: 0n,
      };
      return yield* createSimulatorFromState(initialState);
    });
  }

  // ===========================================================================
  // Instance Properties
  // ===========================================================================

  readonly #stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>;

  /**
   * Observable stream of simulator state changes.
   */
  readonly state$: Stream.Stream<SimulatorState>;

  constructor(stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>, state$: Stream.Stream<SimulatorState>) {
    this.#stateRef = stateRef;
    this.state$ = state$;
  }

  // ===========================================================================
  // Instance Methods
  // ===========================================================================

  /**
   * Get the current simulator state.
   */
  getLatestState(): Effect.Effect<SimulatorState> {
    return SubscriptionRef.get(this.#stateRef);
  }

  /**
   * Distribute Night tokens to a recipient.
   * Used for testing dust token generation.
   *
   * @param recipient - User address to receive Night tokens
   * @param amount - Amount of Night tokens to distribute
   * @param verifyingKey - Signature verifying key for the claim transaction
   */
  rewardNight(
    recipient: UserAddress,
    amount: bigint,
    verifyingKey: SignatureVerifyingKey,
  ): Effect.Effect<BlockInfo, LedgerOps.LedgerError> {
    return SubscriptionRef.modifyEffect(this.#stateRef, (simulatorState) =>
      Effect.gen(function* () {
        const nextNumber = DateOps.secondsToDate(simulatorState.lastTxNumber + 1n);
        const newLedgerState = yield* LedgerOps.ledgerTry(() =>
          simulatorState.ledger.testingDistributeNight(recipient, amount, nextNumber),
        );
        const newSimulatorState: SimulatorState = {
          ...simulatorState,
          ledger: newLedgerState,
        };

        const signature = new SignatureErased();
        const claimRewardsTransaction = new ClaimRewardsTransaction(
          signature.instance,
          newSimulatorState.networkId,
          amount,
          verifyingKey,
          LedgerOps.randomNonce(),
          signature,
        );
        const tx = Transaction.fromRewards(claimRewardsTransaction).eraseProofs();
        const blockContext = yield* Simulator.nextBlockContext(nextNumber);
        return yield* Simulator.apply(newSimulatorState, tx, new WellFormedStrictness(), blockContext);
      }),
    );
  }

  /**
   * Submit a transaction to the simulator.
   *
   * @param tx - Transaction to submit (proofs erased)
   * @param options - Optional submission options
   * @param options.blockFullness - Override block fullness calculation
   * @param options.strictness - Override well-formedness strictness
   */
  submitTransaction(
    tx: ProofErasedTransaction,
    options?: { blockFullness?: SyntheticCost; strictness?: StrictnessConfig },
  ): Effect.Effect<BlockInfo, LedgerOps.LedgerError> {
    const strictness = createStrictness(options?.strictness);

    return SubscriptionRef.modifyEffect(this.#stateRef, (simulatorState) =>
      Effect.gen(function* () {
        const nextNumber = DateOps.secondsToDate(simulatorState.lastTxNumber + 1n);
        const context = yield* Simulator.nextBlockContext(nextNumber);
        return yield* Simulator.apply(simulatorState, tx, strictness, context, options?.blockFullness);
      }),
    );
  }

  /**
   * Fast-forward the simulator to a specific block number.
   * Useful for testing time-sensitive functionality like TTL.
   *
   * @param lastTxNumber - Block number to advance to
   */
  fastForward(lastTxNumber: bigint): Effect.Effect<undefined, LedgerOps.LedgerError> {
    return SubscriptionRef.modify(this.#stateRef, (simulatorState) => [
      undefined,
      {
        ...simulatorState,
        lastTxNumber,
        lastTx: undefined,
        lastTxResult: undefined,
      },
    ]);
  }
}
