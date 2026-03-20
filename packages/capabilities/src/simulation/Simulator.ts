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

import { Array as Arr, Clock, Effect, Either, Encoding, pipe, type Scope, Stream, SubscriptionRef } from 'effect';
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
import { DateOps, LedgerOps, ArrayOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as crypto from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * A transaction included in a block with its execution result.
 */
export type BlockTransaction = Readonly<{
  /** The transaction that was executed */
  tx: ProofErasedTransaction;
  /** The result of executing the transaction */
  result: TransactionResult;
}>;

/**
 * A produced block containing transactions and metadata.
 */
export type Block = Readonly<{
  /** Block number (height) */
  number: bigint;
  /** Block hash */
  hash: string;
  /** Block timestamp */
  timestamp: Date;
  /** Transactions in this block, ordered by execution */
  transactions: readonly BlockTransaction[];
}>;

/**
 * Simulator state containing the ledger, block history, and pending mempool.
 */
export type SimulatorState = Readonly<{
  networkId: NetworkId.NetworkId;
  ledger: LedgerState;
  /** All produced blocks, ordered by block number */
  blocks: readonly Block[];
  /** Pending transactions waiting for block production */
  mempool: readonly PendingTransaction[];
  /** Current simulator time (independent of block numbers) */
  currentTime: Date;
}>;

// =============================================================================
// State Accessors
// =============================================================================

/**
 * Get the last produced block, or undefined if no blocks yet.
 */
export const getLastBlock = (state: SimulatorState): Block | undefined =>
  state.blocks.length > 0 ? state.blocks[state.blocks.length - 1] : undefined;

/**
 * Get the current block number (height of the last block, or 0 if no blocks).
 export const getCurrentBlockNumber = (state: SimulatorState): bigint => getLastBlock(stat
 */
export const getCurrentBlockNumber = (state: SimulatorState): bigint => getLastBlock(state)?.number ?? 0n;

/**
 * Get a block by its number.
 */
export const getBlockByNumber = (state: SimulatorState, number: bigint): Block | undefined =>
  state.blocks.find((b) => b.number === number);

/**
 * Get all transaction results from the last block.
 */
export const getLastBlockResults = (state: SimulatorState): readonly TransactionResult[] =>
  getLastBlock(state)?.transactions.map((t) => t.result) ?? [];

/**
 * Get all events from the last block (flattened from all transactions).
 */
export const getLastBlockEvents = (state: SimulatorState): readonly TransactionResult['events'][number][] =>
  getLastBlockResults(state).flatMap((r) => r.events);

/**
 * Check if there are pending transactions in the mempool.
 */
export const hasPendingTransactions = (state: SimulatorState): boolean => state.mempool.length > 0;

/**
 * Get the current simulator time.
 */
export const getCurrentTime = (state: SimulatorState): Date => state.currentTime;

/**
 * Result of a successful block production.
 */
export type BlockInfo = Readonly<{
  blockNumber: bigint;
  blockHash: string;
}>;

/**
 * Pending transaction waiting for block production.
 */
export type PendingTransaction = Readonly<{
  tx: ProofErasedTransaction;
  strictness: WellFormedStrictness;
}>;

/**
 * Error for invalid block fullness values.
 */
export class InvalidBlockFullnessError extends Error {
  readonly _tag = 'InvalidBlockFullnessError';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBlockFullnessError';
  }
}

// =============================================================================
// Block Production
// =============================================================================

/**
 * Request to produce a block with specific transactions and fullness.
 * This mimics how real nodes work - selecting which transactions to include.
 */
export type BlockProductionRequest = Readonly<{
  /** Transactions to include in this block (selected from the state's mempool) */
  transactions: readonly PendingTransaction[];
  /** Block fullness (0-1) for fee calculation */
  fullness: number;
}>;

/**
 * A block producer is a stream transformer that decides when blocks should be produced.
 *
 * It receives a stream of simulator state changes and transforms it into a stream
 * of block production requests. Each request specifies which transactions to include
 * and the block fullness for fee calculation.
 *
 * @example
 * ```typescript
 * // Custom producer: produce block when mempool has 5+ transactions
 * const batchedProducer: BlockProducer = (states) =>
 *   states.pipe(
 *     Stream.filter((s) => s.mempool.length >= 5),
 *     Stream.map((s) => ({
 *       transactions: [...s.mempool],
 *       fullness: 0.5,
 *     }))
 *   );
 * ```
 */
export type BlockProducer = (states: Stream.Stream<SimulatorState>) => Stream.Stream<BlockProductionRequest>;

/**
 * Fullness specification: static number or callback based on state.
 */
export type FullnessSpec = number | ((state: SimulatorState) => number);

/**
 * Resolve fullness from spec and state.
 */
const resolveFullness = (spec: FullnessSpec, state: SimulatorState): number =>
  typeof spec === 'function' ? spec(state) : spec;

/**
 * Helper to create a request that includes all mempool transactions.
 */
const allTransactions = (state: SimulatorState, fullness: number): BlockProductionRequest => ({
  transactions: [...state.mempool],
  fullness,
});

/**
 * Default block producer: produces a block for each state change with non-empty mempool.
 *
 * @param fullness - Static fullness (0-1) or callback based on state
 */
export const immediateBlockProducer =
  (fullness: FullnessSpec = 0): BlockProducer =>
  (states) =>
    states.pipe(
      Stream.filter(hasPendingTransactions),
      Stream.map((s) => allTransactions(s, resolveFullness(fullness, s))),
    );

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
  | {
      readonly mode: 'blank';
      readonly networkId: NetworkId.NetworkId;
      readonly blockProducer?: BlockProducer;
    }
  | {
      readonly mode: 'genesis';
      readonly genesisMints: Arr.NonEmptyArray<GenesisMint>;
      readonly networkId?: NetworkId.NetworkId;
      readonly blockProducer?: BlockProducer;
    };

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Compute SHA-256 hash of a bigint, returning hex-encoded result.
 */
const simpleHash = (input: bigint): Effect.Effect<string> =>
  Effect.promise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.toString()))).pipe(
    Effect.andThen((out) => Encoding.encodeHex(new Uint8Array(out))),
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
  static blockHash = (blockTime: Date): Effect.Effect<string> => simpleHash(DateOps.dateToSeconds(blockTime));

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
   * Pure state transition: apply a transaction to the simulator state.
   * Returns Either with the new state or an error.
   *
   * @param simulatorState - Current simulator state
   * @param tx - Transaction to apply
   * @param strictness - Well-formedness strictness options
   * @param blockContext - Block context for the transaction
   * @param options - Optional parameters
   * @param options.blockNumber - Override block number (defaults to last block + 1)
   * @param options.blockFullness - Override detailed block fullness (SyntheticCost)
   * @param options.overallBlockFullness - Override overall block fullness (0-1 value)
   */
  static apply(
    simulatorState: SimulatorState,
    tx: ProofErasedTransaction,
    strictness: WellFormedStrictness,
    blockContext: BlockContext,
    options?: { blockNumber?: bigint; blockFullness?: SyntheticCost; overallBlockFullness?: number },
  ): Either.Either<[Block, SimulatorState], LedgerOps.LedgerError> {
    return LedgerOps.ledgerTry(() => {
      const computedFullness = options?.blockFullness ?? tx.cost(simulatorState.ledger.parameters);

      const detailedBlockFullness = simulatorState.ledger.parameters.normalizeFullness(computedFullness);
      const computedBlockFullness =
        options?.overallBlockFullness ??
        Math.max(
          detailedBlockFullness.readTime,
          detailedBlockFullness.computeTime,
          detailedBlockFullness.blockUsage,
          detailedBlockFullness.bytesWritten,
          detailedBlockFullness.bytesChurned,
        );

      const blockNumber = options?.blockNumber ?? getCurrentBlockNumber(simulatorState) + 1n;
      const blockTime = simulatorState.currentTime;
      const verifiedTransaction = tx.wellFormed(simulatorState.ledger, strictness, blockTime);
      const transactionContext = new TransactionContext(simulatorState.ledger, blockContext);
      const [newLedgerState, txResult] = simulatorState.ledger.apply(verifiedTransaction, transactionContext);

      const newBlock: Block = {
        number: blockNumber,
        hash: blockContext.parentBlockHash,
        timestamp: blockTime,
        transactions: [{ tx, result: txResult }],
      };

      const newSimulatorState: SimulatorState = {
        ...simulatorState,
        ledger: newLedgerState.postBlockUpdate(blockTime, detailedBlockFullness, computedBlockFullness),
        blocks: [...simulatorState.blocks, newBlock],
      };

      return [newBlock, newSimulatorState];
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
      ? Simulator.initBlank(config.networkId, config.blockProducer)
      : Simulator.initWithGenesis(config.genesisMints, config.networkId, config.blockProducer);
  }

  /**
   * Initialize simulator with blank ledger state.
   */
  private static initBlank(
    networkId: NetworkId.NetworkId,
    blockProducer?: BlockProducer,
  ): Effect.Effect<Simulator, never, Scope.Scope> {
    const initialState: SimulatorState = {
      networkId,
      ledger: LedgerState.blank(networkId),
      blocks: [],
      mempool: [],
      currentTime: new Date(0),
    };
    return Simulator.fromState(initialState, blockProducer);
  }

  /**
   * Initialize simulator with genesis mints (pre-funded accounts).
   */
  private static initWithGenesis(
    genesisMints: Arr.NonEmptyArray<GenesisMint>,
    networkId: NetworkId.NetworkId = NetworkId.NetworkId.Undeployed,
    blockProducer?: BlockProducer,
  ): Effect.Effect<Simulator, never, Scope.Scope> {
    const emptyState = LedgerState.blank(networkId);
    const noStrictness = createStrictness();

    const makeTransactions = (context: BlockContext) =>
      Effect.gen(function* () {
        const nowMillis = yield* Clock.currentTimeMillis;
        const verificationTime = new Date(nowMillis);

        const proofErasedTx = pipe(
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
        );

        const verifiedTx = proofErasedTx.wellFormed(emptyState, noStrictness, verificationTime);

        const [initialState, initialResult] = emptyState.apply(verifiedTx, new TransactionContext(emptyState, context));
        const postBlockUpdateState = initialState.postBlockUpdate(verificationTime);

        return {
          initialResult,
          initialState: postBlockUpdateState,
          proofErasedTx,
        } as const;
      });

    return Effect.gen(function* () {
      const genesisTime = new Date(0);
      const context = yield* Simulator.nextBlockContext(genesisTime);
      const init = yield* makeTransactions(context);

      // Create genesis block with the mint transaction
      const genesisBlock: Block = {
        number: 0n,
        hash: context.parentBlockHash,
        timestamp: genesisTime,
        transactions: [{ tx: init.proofErasedTx, result: init.initialResult }],
      };

      const initialState: SimulatorState = {
        networkId,
        ledger: init.initialState,
        blocks: [genesisBlock],
        mempool: [],
        currentTime: genesisTime, // Time stays at genesis; next block will advance it
      };
      return yield* Simulator.fromState(initialState, blockProducer);
    });
  }

  /**
   * Create a Simulator from an initial state with proper stream setup.
   */
  private static fromState(
    initialState: SimulatorState,
    blockProducer?: BlockProducer,
  ): Effect.Effect<Simulator, never, Scope.Scope> {
    return Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make<SimulatorState>(initialState);

      // Create a shared stream of state changes.
      // Note: SubscriptionRef.changes only emits on updates, not the initial value.
      // Consumers (sync services) should get the initial state via getLatestState() if needed.
      const stateChangesStream = yield* Stream.share(stateRef.changes, {
        capacity: 'unbounded',
        replay: 1,
      });

      // Create instance first so we can use instance method in the stream
      const simulator = new Simulator(stateRef, stateChangesStream);

      // Set up block production stream
      const effectiveProducer = blockProducer ?? immediateBlockProducer();
      const statesForProducer = Stream.concat(Stream.succeed(initialState), stateRef.changes);
      const productionRequests = effectiveProducer(statesForProducer);

      yield* Effect.forkScoped(
        productionRequests.pipe(
          Stream.runForEach((request) => simulator.#produceBlock(request.transactions, request.fullness)),
        ),
      );

      return simulator;
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
   * Distribute Night tokens to a recipient and submit claim transaction to mempool.
   * Used for testing dust token generation.
   *
   * This method:
   * 1. Modifies the ledger to make Night tokens claimable
   * 2. Creates and submits a ClaimRewardsTransaction to the mempool
   * 3. The block producer will process the transaction
   *
   * @param recipient - User address to receive Night tokens
   * @param amount - Amount of Night tokens to distribute
   * @param verifyingKey - Signature verifying key for the claim transaction
   */
  rewardNight(
    recipient: UserAddress,
    amount: bigint,
    verifyingKey: SignatureVerifyingKey,
  ): Effect.Effect<void, LedgerOps.LedgerError> {
    const stateRef = this.#stateRef;

    return Effect.gen(function* () {
      // First, modify ledger state to make Night tokens claimable
      yield* SubscriptionRef.updateEffect(stateRef, (simulatorState) =>
        Effect.gen(function* () {
          const newLedgerState = yield* LedgerOps.ledgerTry(() =>
            simulatorState.ledger.testingDistributeNight(recipient, amount, simulatorState.currentTime),
          );
          return {
            ...simulatorState,
            ledger: newLedgerState,
          };
        }),
      );

      // Then create and submit the claim transaction to mempool
      const currentState = yield* SubscriptionRef.get(stateRef);
      const signature = new SignatureErased();
      const claimRewardsTransaction = new ClaimRewardsTransaction(
        signature.instance,
        currentState.networkId,
        amount,
        verifyingKey,
        LedgerOps.randomNonce(),
        signature,
      );
      const tx = Transaction.fromRewards(claimRewardsTransaction).eraseProofs();

      // Submit to mempool - block producer will handle block creation
      yield* SubscriptionRef.update(stateRef, (s) => ({
        ...s,
        mempool: [...s.mempool, { tx, strictness: new WellFormedStrictness() }],
      }));

      // Wait for block producer to process the transaction
      // Use a sleep to allow the forked block producer fiber time to run
      // Matching the sleep duration used by submission service (100ms)
      yield* Effect.sleep('100 millis');
    });
  }

  /**
   * Submit a transaction to the simulator's mempool.
   *
   * This only adds the transaction to the mempool. Block production is handled
   * separately by the configured block producer:
   * - immediate: produces a block on each state change
   * - batched: produces when batch size is reached
   * - manual: produces when trigger() is called
   * - debounced: produces after inactivity period
   *
   * @param tx - Transaction to submit (proofs erased)
   * @param options - Optional submission options
   * @param options.strictness - Override well-formedness strictness
   */
  submitTransaction(tx: ProofErasedTransaction, options?: { strictness?: StrictnessConfig }): Effect.Effect<void> {
    const strictness = createStrictness(options?.strictness);
    const pendingTx: PendingTransaction = { tx, strictness };

    return SubscriptionRef.update(this.#stateRef, (s) => ({
      ...s,
      mempool: [...s.mempool, pendingTx],
    }));
  }

  /**
   * Fast-forward the simulator time by the given number of seconds.
   * Does not produce a block - only advances the internal clock.
   * Useful for testing time-sensitive functionality like TTL.
   *
   * @param seconds - Number of seconds to advance (must be positive)
   */
  fastForward(seconds: bigint): Effect.Effect<void> {
    return SubscriptionRef.update(this.#stateRef, (simulatorState) => ({
      ...simulatorState,
      currentTime: DateOps.addSeconds(simulatorState.currentTime, seconds),
    }));
  }

  // ===========================================================================
  // Internal Block Production
  // ===========================================================================

  /**
   * Produce a block from the given transactions.
   * Internal method used by the block producer stream.
   */
  #produceBlock(
    transactions: readonly PendingTransaction[],
    fullness: number,
  ): Effect.Effect<Block, LedgerOps.LedgerError> {
    const stateRef = this.#stateRef;

    return Effect.gen(function* () {
      const blockResult = yield* SubscriptionRef.modifyEffect(
        stateRef,
        (simulatorState): Effect.Effect<readonly [Either.Either<Block, LedgerOps.LedgerError>, SimulatorState]> =>
          Effect.gen(function* () {
            const nextBlockNumber = getCurrentBlockNumber(simulatorState) + 1n;
            // Advance time first, then use it for the block
            const blockTime = DateOps.addSeconds(simulatorState.currentTime, 1);

            if (transactions.length === 0) {
              // No transactions to process, return empty block
              const blockHash = yield* Simulator.blockHash(blockTime);

              const emptyBlock: Block = {
                number: nextBlockNumber,
                hash: blockHash,
                timestamp: blockTime,
                transactions: [],
              };

              const newState: SimulatorState = {
                ...simulatorState,
                blocks: [...simulatorState.blocks, emptyBlock],
                mempool: simulatorState.mempool.filter((tx) => !transactions.includes(tx)),
                currentTime: blockTime,
              };

              return [Either.right(emptyBlock), newState] as const;
            }

            const blockContext = yield* Simulator.nextBlockContext(blockTime);

            // Process all transactions, collecting results
            const blockTransactions: BlockTransaction[] = [];
            let currentLedger = simulatorState.ledger;

            for (const pendingTx of transactions) {
              const result = LedgerOps.ledgerTry(() => {
                const computedFullness = pendingTx.tx.cost(currentLedger.parameters);
                const detailedBlockFullness = currentLedger.parameters.normalizeFullness(computedFullness);
                const computedBlockFullness = Math.max(
                  fullness,
                  detailedBlockFullness.readTime,
                  detailedBlockFullness.computeTime,
                  detailedBlockFullness.blockUsage,
                  detailedBlockFullness.bytesWritten,
                  detailedBlockFullness.bytesChurned,
                );

                const verifiedTransaction = pendingTx.tx.wellFormed(currentLedger, pendingTx.strictness, blockTime);
                const transactionContext = new TransactionContext(currentLedger, blockContext);
                const [newLedgerState, txResult] = currentLedger.apply(verifiedTransaction, transactionContext);
                currentLedger = newLedgerState.postBlockUpdate(blockTime, detailedBlockFullness, computedBlockFullness);

                return txResult;
              });

              if (Either.isLeft(result)) {
                // Transaction failed, return error
                const newState: SimulatorState = {
                  ...simulatorState,
                  mempool: simulatorState.mempool.filter((tx) => !transactions.includes(tx)),
                };
                return [Either.left(result.left), newState] as const;
              }

              blockTransactions.push({ tx: pendingTx.tx, result: result.right });
            }

            const blockHash = yield* Simulator.blockHash(blockTime);

            const block: Block = {
              number: nextBlockNumber,
              hash: blockHash,
              timestamp: blockTime,
              transactions: blockTransactions,
            };

            const newState: SimulatorState = {
              ...simulatorState,
              ledger: currentLedger,
              blocks: [...simulatorState.blocks, block],
              mempool: simulatorState.mempool.filter((tx) => !transactions.includes(tx)),
              currentTime: blockTime,
            };

            return [Either.right(block), newState] as const;
          }),
      );

      // Return the result
      if (Either.isLeft(blockResult)) {
        return yield* Effect.fail(blockResult.left);
      }
      return blockResult.right;
    });
  }

  // ===========================================================================
  // Query Method
  // ===========================================================================

  /**
   * Query the simulator state with a custom function.
   * This is a generic query mechanism that allows extracting any information
   * from the current state without modifying it.
   *
   * @param fn - Function that receives the current state and returns a result
   * @returns The result of applying the function to the current state
   *
   * @example
   * ```typescript
   * // Query fee prices
   * const feePrices = yield* simulator.query(state => state.ledger.parameters.feePrices);
   *
   * // Use composable state accessors
   * const blockNumber = yield* simulator.query(getCurrentBlockNumber);
   * const lastBlock = yield* simulator.query(getLastBlock);
   * const events = yield* simulator.query(getLastBlockEvents);
   *
   * // Query UTXOs for an address
   * const utxos = yield* simulator.query(state => Array.from(state.ledger.utxo.filter(address)));
   *
   * // Complex query returning multiple values
   * const info = yield* simulator.query(state => ({
   *   networkId: state.networkId,
   *   blockNumber: getCurrentBlockNumber(state),
   *   feePrices: state.ledger.parameters.feePrices,
   * }));
   * ```
   */
  query<T>(fn: (state: SimulatorState) => T): Effect.Effect<T> {
    return Effect.map(SubscriptionRef.get(this.#stateRef), fn);
  }
}
