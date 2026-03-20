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
 * SimulatorState types and pure functions for state manipulation.
 *
 * This module contains the core data types and pure functions for working with
 * simulator state. All functions are synchronous and side-effect free.
 */

import { Either, Stream } from 'effect';
import {
  LedgerState,
  type BlockContext,
  WellFormedStrictness,
  type TransactionResult,
  TransactionContext,
  type ProofErasedTransaction,
  type SyntheticCost,
  type RawTokenType,
  type ZswapSecretKeys,
} from '@midnight-ntwrk/ledger-v8';
import { DateOps, LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

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
 * Pending transaction waiting for block production.
 */
export type PendingTransaction = Readonly<{
  tx: ProofErasedTransaction;
  strictness: WellFormedStrictness;
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

/**
 * Result of a successful block production.
 */
export type BlockInfo = Readonly<{
  blockNumber: bigint;
  blockHash: string;
}>;

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

// =============================================================================
// State Accessors (Pure Functions)
// =============================================================================

/**
 * Get the last produced block, or undefined if no blocks yet.
 */
export const getLastBlock = (state: SimulatorState): Block | undefined =>
  state.blocks.length > 0 ? state.blocks[state.blocks.length - 1] : undefined;

/**
 * Get the current block number (height of the last block, or 0 if no blocks).
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

// =============================================================================
// State Transformations (Pure Functions)
// =============================================================================

/**
 * Resolve fullness from spec and state.
 */
export const resolveFullness = (spec: FullnessSpec, state: SimulatorState): number =>
  typeof spec === 'function' ? spec(state) : spec;

/**
 * Create a block production request that includes all mempool transactions.
 */
export const allMempoolTransactions = (state: SimulatorState, fullness: number): BlockProductionRequest => ({
  transactions: [...state.mempool],
  fullness,
});

/**
 * Create a blank initial state.
 */
export const blankState = (networkId: NetworkId.NetworkId): SimulatorState => ({
  networkId,
  ledger: LedgerState.blank(networkId),
  blocks: [],
  mempool: [],
  currentTime: new Date(0),
});

/**
 * Add a pending transaction to the mempool.
 */
export const addToMempool = (state: SimulatorState, pendingTx: PendingTransaction): SimulatorState => ({
  ...state,
  mempool: [...state.mempool, pendingTx],
});

/**
 * Remove transactions from the mempool.
 */
export const removeFromMempool = (
  state: SimulatorState,
  transactions: readonly PendingTransaction[],
): SimulatorState => ({
  ...state,
  mempool: state.mempool.filter((tx) => !transactions.includes(tx)),
});

/**
 * Advance the simulator time by the given number of seconds.
 */
export const advanceTime = (state: SimulatorState, seconds: bigint): SimulatorState => ({
  ...state,
  currentTime: DateOps.addSeconds(state.currentTime, seconds),
});

/**
 * Update the ledger state.
 */
export const updateLedger = (state: SimulatorState, ledger: LedgerState): SimulatorState => ({
  ...state,
  ledger,
});

/**
 * Append a block to the state and update time.
 */
export const appendBlock = (state: SimulatorState, block: Block, newLedger: LedgerState): SimulatorState => ({
  ...state,
  ledger: newLedger,
  blocks: [...state.blocks, block],
  currentTime: block.timestamp,
});

// =============================================================================
// Transaction Application (Pure Function)
// =============================================================================

/**
 * Pure state transition: apply a transaction to the simulator state.
 * Returns Either with the new state or an error.
 *
 * @param state - Current simulator state
 * @param tx - Transaction to apply
 * @param strictness - Well-formedness strictness options
 * @param blockContext - Block context for the transaction
 * @param options - Optional parameters
 * @param options.blockNumber - Override block number (defaults to last block + 1)
 * @param options.blockFullness - Override detailed block fullness (SyntheticCost)
 * @param options.overallBlockFullness - Override overall block fullness (0-1 value)
 */
export const applyTransaction = (
  state: SimulatorState,
  tx: ProofErasedTransaction,
  strictness: WellFormedStrictness,
  blockContext: BlockContext,
  options?: { blockNumber?: bigint; blockFullness?: SyntheticCost; overallBlockFullness?: number },
): Either.Either<[Block, SimulatorState], LedgerOps.LedgerError> => {
  return LedgerOps.ledgerTry(() => {
    const computedFullness = options?.blockFullness ?? tx.cost(state.ledger.parameters);

    const detailedBlockFullness = state.ledger.parameters.normalizeFullness(computedFullness);
    const computedBlockFullness =
      options?.overallBlockFullness ??
      Math.max(
        detailedBlockFullness.readTime,
        detailedBlockFullness.computeTime,
        detailedBlockFullness.blockUsage,
        detailedBlockFullness.bytesWritten,
        detailedBlockFullness.bytesChurned,
      );

    const blockNumber = options?.blockNumber ?? getCurrentBlockNumber(state) + 1n;
    const blockTime = state.currentTime;
    const verifiedTransaction = tx.wellFormed(state.ledger, strictness, blockTime);
    const transactionContext = new TransactionContext(state.ledger, blockContext);
    const [newLedgerState, txResult] = state.ledger.apply(verifiedTransaction, transactionContext);

    const newBlock: Block = {
      number: blockNumber,
      hash: blockContext.parentBlockHash,
      timestamp: blockTime,
      transactions: [{ tx, result: txResult }],
    };

    const newState: SimulatorState = {
      ...state,
      ledger: newLedgerState.postBlockUpdate(blockTime, detailedBlockFullness, computedBlockFullness),
      blocks: [...state.blocks, newBlock],
    };

    return [newBlock, newState];
  });
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a WellFormedStrictness instance with configurable options.
 * All options default to false for maximum testing flexibility.
 *
 * Note: WellFormedStrictness is a class from the ledger library that requires
 * mutation to configure. This is unavoidable given the external API design.
 */
export const createStrictness = (config: StrictnessConfig = {}): WellFormedStrictness => {
  const strictness = new WellFormedStrictness();
  strictness.enforceBalancing = config.enforceBalancing ?? false;
  strictness.verifyNativeProofs = config.verifyNativeProofs ?? false;
  strictness.verifyContractProofs = config.verifyContractProofs ?? false;
  strictness.enforceLimits = config.enforceLimits ?? false;
  strictness.verifySignatures = config.verifySignatures ?? false;
  return strictness;
};

/**
 * Compute block hash from block time (SHA-256 of seconds since epoch).
 */
export const blockHash = async (blockTime: Date): Promise<string> => {
  const crypto = await import('crypto');
  const input = DateOps.dateToSeconds(blockTime).toString();
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const { Encoding } = await import('effect');
  return Encoding.encodeHex(new Uint8Array(hashBuffer));
};

/**
 * Create the next block context from block time.
 */
export const nextBlockContext = async (blockTime: Date): Promise<BlockContext> => {
  const hash = await blockHash(blockTime);
  return {
    parentBlockHash: hash,
    secondsSinceEpoch: DateOps.dateToSeconds(blockTime),
    secondsSinceEpochErr: 1,
    lastBlockTime: 1n,
  };
};
