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
 * This module contains the core data types and pure functions for working with simulator state. All functions are
 * synchronous and side-effect free.
 */

import { Either, Function as EFunction, type Stream, Array as EArray } from 'effect';
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
  type UserAddress,
  type SignatureVerifyingKey,
} from '@midnight-ntwrk/ledger-v8';
import { DateOps, LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { type NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

// =============================================================================
// Types
// =============================================================================

/** A transaction included in a block with its execution result. */
export type BlockTransaction = Readonly<{
  /** The transaction that was executed */
  tx: ProofErasedTransaction;
  /** The result of executing the transaction */
  result: TransactionResult;
}>;

/** A produced block containing transactions and metadata. */
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
 * Pending transaction waiting for block production. Strictness is optional - if not specified, block producer assigns
 * default when creating block.
 */
export type PendingTransaction = Readonly<{
  tx: ProofErasedTransaction;
  /** Optional per-transaction strictness. If not specified, block producer assigns default. */
  strictness?: WellFormedStrictness;
}>;

/**
 * Transaction ready for block production with strictness assigned. Block producer ensures all transactions have
 * strictness before block creation.
 */
export type ReadyTransaction = Readonly<{
  tx: ProofErasedTransaction;
  /** Strictness for validation (assigned by block producer if not specified on pending tx). */
  strictness: WellFormedStrictness;
}>;

/** Simulator state containing the ledger, block history, and pending mempool. */
export type SimulatorState = Readonly<{
  networkId: NetworkId.NetworkId;
  ledger: LedgerState;
  /** All produced blocks, ordered by block number */
  blocks: EArray.NonEmptyArray<Block>;
  /** Pending transactions waiting for block production */
  mempool: readonly PendingTransaction[];
  /** Current simulator time (independent of block numbers) */
  currentTime: Date;
}>;

/** Result of a successful block production. */
export type BlockInfo = Readonly<{
  blockNumber: bigint;
  blockHash: string;
}>;

/**
 * Request to produce a block with specific transactions, fullness, and optional strictness override. This mimics how
 * real nodes work - selecting which transactions to include and how to validate them.
 *
 * The block producer can optionally specify a strictness that overrides per-transaction strictness. This enables
 * patterns like:
 *
 * - Enforcing balancing for all blocks after genesis
 * - Using a decorator pattern to modify strictness behavior
 * - Testing specific validation scenarios
 */
export type BlockProductionRequest = Readonly<{
  /** Transactions to include in this block with strictness assigned */
  transactions: readonly ReadyTransaction[];
  /** Block fullness (0-1) for fee calculation */
  fullness: number;
}>;

/**
 * A block producer is a stream transformer that decides when blocks should be produced.
 *
 * It receives a stream of simulator state changes and transforms it into a stream of block production requests. Each
 * request specifies which transactions to include and the block fullness for fee calculation.
 *
 * @example
 *   ```typescript
 *   // Custom producer: produce block when mempool has 5+ transactions
 *   const batchedProducer: BlockProducer = (states) =>
 *     states.pipe(
 *       Stream.filter((s) => s.mempool.length >= 5),
 *       Stream.map((s) => ({
 *         transactions: [...s.mempool],
 *         fullness: 0.5,
 *       }))
 *     );
 *   ```;
 */
export type BlockProducer = (states: Stream.Stream<SimulatorState>) => Stream.Stream<BlockProductionRequest>;

/** Fullness specification: static number or callback based on state. */
export type FullnessSpec = number | ((state: SimulatorState) => number);

/**
 * Genesis mint specification for shielded tokens.
 *
 * @example
 *   ```typescript
 *   const mint: ShieldedGenesisMint = {
 *     type: 'shielded',
 *     tokenType: ledger.shieldedToken().raw,
 *     amount: 1000n,
 *     recipient: secretKeys,
 *   };
 *   ```;
 */
export type ShieldedGenesisMint = Readonly<{
  type: 'shielded';
  tokenType: RawTokenType;
  amount: bigint;
  recipient: ZswapSecretKeys;
}>;

/**
 * Genesis mint specification for unshielded tokens.
 *
 * For **custom tokens**: Minted directly from nothing (enforceBalancing disabled).
 *
 * For **Night tokens** (native token): Requires `verifyingKey` field. Night cannot be minted from nothing due to supply
 * invariant, so the reward/claim mechanism is used internally. Night is auto-detected by comparing `tokenType` with
 * `ledger.nativeToken().raw`.
 *
 * Note: Night claims have a minimum amount requirement (~14077). Use larger amounts to ensure the claim transaction
 * succeeds.
 *
 * @example
 *   ```typescript
 *   // Custom unshielded token
 *   const customMint: UnshieldedGenesisMint = {
 *     type: 'unshielded',
 *     tokenType: customToken,
 *     amount: 1000n,
 *     recipient: userAddress,
 *   };
 *
 *   // Night token (native token) - requires verifyingKey
 *   const nightMint: UnshieldedGenesisMint = {
 *     type: 'unshielded',
 *     tokenType: ledger.nativeToken().raw,
 *     amount: 1_000_000n, // Must exceed minimum claim amount (~14077)
 *     recipient: userAddress,
 *     verifyingKey: signatureVerifyingKey,
 *   };
 *   ```;
 */
export type UnshieldedGenesisMint = Readonly<{
  type: 'unshielded';
  tokenType: RawTokenType;
  amount: bigint;
  recipient: UserAddress;
  /** Required for Night tokens (native token). Used for the claim transaction signature. */
  verifyingKey?: SignatureVerifyingKey;
}>;

/**
 * Genesis mint specification for initializing the simulator with pre-funded accounts.
 *
 * Uses a tagged union pattern consistent with the facade API:
 *
 * - **Shielded**: `{ type: 'shielded', tokenType, amount, recipient: ZswapSecretKeys }`
 * - **Unshielded**: `{ type: 'unshielded', tokenType, amount, recipient, verifyingKey? }`
 *
 *   - Custom tokens: minted directly (verifyingKey not needed)
 *   - Night tokens: auto-detected by tokenType, uses reward/claim mechanism (verifyingKey required)
 */
export type GenesisMint = ShieldedGenesisMint | UnshieldedGenesisMint;

/** Configuration for well-formedness strictness checks. All options default to false for testing flexibility. */
export type StrictnessConfig = Readonly<{
  enforceBalancing?: boolean;
  verifyNativeProofs?: boolean;
  verifyContractProofs?: boolean;
  enforceLimits?: boolean;
  verifySignatures?: boolean;
}>;

/**
 * Default strictness for post-genesis blocks.
 *
 * In a realistic simulation:
 *
 * - Signatures should be verified (verifySignatures: true)
 * - Proofs cannot be verified because they're erased (verifyNativeProofs/verifyContractProofs: false)
 * - Limits should be enforced (enforceLimits: true)
 * - Balancing must be enforced (enforceBalancing: true) - transactions must pay fees
 *
 * Note: Genesis blocks typically disable all strictness to allow initial token distribution.
 */
export const defaultStrictness: StrictnessConfig = {
  enforceBalancing: true,
  verifyNativeProofs: false,
  verifyContractProofs: false,
  enforceLimits: true,
  verifySignatures: true,
};

/** Strictness for genesis blocks - all checks disabled to allow initial token distribution. */
export const genesisStrictness: StrictnessConfig = {
  enforceBalancing: false,
  verifyNativeProofs: false,
  verifyContractProofs: false,
  enforceLimits: false,
  verifySignatures: false,
};

/**
 * Assign strictness to a pending transaction, creating a ready transaction. If the pending transaction already has
 * strictness, use it; otherwise use the provided default.
 */
export const assignStrictness = (
  pendingTx: PendingTransaction,
  defaultStrictness: WellFormedStrictness,
): ReadyTransaction => ({
  tx: pendingTx.tx,
  strictness: pendingTx.strictness ?? defaultStrictness,
});

/**
 * Assign strictness to all pending transactions, creating ready transactions. Transactions with existing strictness
 * keep their strictness; others get the default.
 */
export const assignStrictnessToAll = (
  transactions: readonly PendingTransaction[],
  defaultStrictness: WellFormedStrictness,
): readonly ReadyTransaction[] => transactions.map((tx) => assignStrictness(tx, defaultStrictness));

// =============================================================================
// State Accessors (Pure Functions)
// =============================================================================

/** Get the last produced block, or undefined if no blocks yet. */
export const getLastBlock = (state: SimulatorState): Block => EArray.lastNonEmpty(state.blocks);

/** Get the current block number (height of the last block, or 0 if no blocks). */
export const getCurrentBlockNumber = (state: SimulatorState): bigint => getLastBlock(state)?.number;

/** Get a block by its number. */
export const getBlockByNumber: {
  (number: bigint): (state: SimulatorState) => Block | undefined;
  (state: SimulatorState, number: bigint): Block | undefined;
} = EFunction.dual(2, (state: SimulatorState, number: bigint): Block | undefined =>
  state.blocks.find((b) => b.number === number),
);

/** Get all transaction results from the last block. */
export const getLastBlockResults = (state: SimulatorState): readonly TransactionResult[] =>
  getLastBlock(state)?.transactions.map((t) => t.result) ?? [];

/** Get all events from the last block (flattened from all transactions). */
export const getLastBlockEvents = (state: SimulatorState): readonly TransactionResult['events'][number][] =>
  getLastBlockResults(state).flatMap((r) => r.events);

/**
 * Get all events from blocks with number >= fromBlockNumber. Returns events ordered by block number, with each block's
 * transactions flattened.
 *
 * Use this with the wallet's next-to-process index: `appliedIndex` after processing should be set to `lastBlockNumber +
 * 1`, not `lastBlockNumber`.
 */
export const getBlockEventsFrom: {
  (fromBlockNumber: bigint): (state: SimulatorState) => readonly TransactionResult['events'][number][];
  (state: SimulatorState, fromBlockNumber: bigint): readonly TransactionResult['events'][number][];
} = EFunction.dual(
  2,
  (state: SimulatorState, fromBlockNumber: bigint): readonly TransactionResult['events'][number][] =>
    state.blocks
      .filter((b) => b.number >= fromBlockNumber)
      .flatMap((b) => b.transactions.flatMap((t) => t.result.events)),
);

/**
 * @deprecated Use getBlockEventsFrom instead with proper appliedIndex semantics Get all events from blocks with number
 *
 * > AfterBlockNumber.
 */
export const getBlockEventsSince: {
  (afterBlockNumber: bigint): (state: SimulatorState) => readonly TransactionResult['events'][number][];
  (state: SimulatorState, afterBlockNumber: bigint): readonly TransactionResult['events'][number][];
} = EFunction.dual(
  2,
  (state: SimulatorState, afterBlockNumber: bigint): readonly TransactionResult['events'][number][] =>
    state.blocks
      .filter((b) => b.number > afterBlockNumber)
      .flatMap((b) => b.transactions.flatMap((t) => t.result.events)),
);

/** Check if there are pending transactions in the mempool. */
export const hasPendingTransactions = (state: SimulatorState): boolean => state.mempool.length > 0;

/** Get the current simulator time. */
export const getCurrentTime = (state: SimulatorState): Date => state.currentTime;

// =============================================================================
// State Transformations (Pure Functions)
// =============================================================================

/** Resolve fullness from spec and state. */
export const resolveFullness = (spec: FullnessSpec, state: SimulatorState): number =>
  typeof spec === 'function' ? spec(state) : spec;

/** Create a block production request that includes all mempool transactions. */
export const allMempoolTransactions = (
  state: SimulatorState,
  fullness: number,
  defaultStrictness: WellFormedStrictness,
): BlockProductionRequest => ({
  transactions: assignStrictnessToAll(state.mempool, defaultStrictness),
  fullness,
});

/** Create a blank initial state. */
export const blankState = async (networkId: NetworkId.NetworkId): Promise<SimulatorState> => {
  const blankGenesis: Block = {
    number: 0n,
    hash: await blockHash(0n),
    timestamp: new Date(0),
    transactions: [],
  };
  return {
    networkId,
    ledger: LedgerState.blank(networkId),
    blocks: [blankGenesis],
    mempool: [],
    currentTime: new Date(0),
  };
};

/** Add a pending transaction to the mempool. */
export const addToMempool = (state: SimulatorState, pendingTx: PendingTransaction): SimulatorState => ({
  ...state,
  mempool: [...state.mempool, pendingTx],
});

/** Remove transactions from the mempool. */
export const removeFromMempool = (state: SimulatorState, transactions: readonly ReadyTransaction[]): SimulatorState => {
  const txsToRemove = new Set(transactions.map((t) => t.tx));
  return {
    ...state,
    mempool: state.mempool.filter((pending) => !txsToRemove.has(pending.tx)),
  };
};

/** Advance the simulator time by the given number of seconds. */
export const advanceTime = (state: SimulatorState, seconds: bigint): SimulatorState => ({
  ...state,
  currentTime: DateOps.addSeconds(state.currentTime, seconds),
});

/** Update the ledger state. */
export const updateLedger = (state: SimulatorState, ledger: LedgerState): SimulatorState => ({
  ...state,
  ledger,
});

/** Append a block to the state and update time. */
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
 * Pure state transition: apply a transaction to the simulator state. Returns Either with the new state or an error.
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
// Block Production (Pure Functions)
// =============================================================================

/** Result of processing a single transaction. */
export type TransactionProcessingResult = Readonly<{
  tx: ProofErasedTransaction;
  result: TransactionResult;
  newLedger: LedgerState;
}>;

/**
 * Process a single pending transaction against the current ledger. Returns Either with the processing result or an
 * error.
 *
 * @param ledger - Current ledger state
 * @param readyTx - Transaction to process
 * @param blockTime - Block timestamp
 * @param blockContext - Block context
 * @param minFullness - Minimum block fullness to use
 */
export const processTransaction = (
  ledger: LedgerState,
  readyTx: ReadyTransaction,
  blockTime: Date,
  blockContext: BlockContext,
  minFullness: number,
): Either.Either<TransactionProcessingResult, LedgerOps.LedgerError> => {
  return LedgerOps.ledgerTry(() => {
    const computedFullness = readyTx.tx.cost(ledger.parameters);
    const detailedBlockFullness = ledger.parameters.normalizeFullness(computedFullness);
    const computedBlockFullness = Math.max(
      minFullness,
      detailedBlockFullness.readTime,
      detailedBlockFullness.computeTime,
      detailedBlockFullness.blockUsage,
      detailedBlockFullness.bytesWritten,
      detailedBlockFullness.bytesChurned,
    );

    // Use the assigned strictness
    const verifiedTransaction = readyTx.tx.wellFormed(ledger, readyTx.strictness, blockTime);
    const transactionContext = new TransactionContext(ledger, blockContext);
    const [newLedgerState, txResult] = ledger.apply(verifiedTransaction, transactionContext);
    const postBlockLedger = newLedgerState.postBlockUpdate(blockTime, detailedBlockFullness, computedBlockFullness);

    return {
      tx: readyTx.tx,
      result: txResult,
      newLedger: postBlockLedger,
    };
  });
};

/**
 * Process multiple transactions in sequence, accumulating results. Returns Either with all results and final ledger, or
 * first error. Each transaction uses its assigned strictness (from ReadyTransaction).
 *
 * @param ledger - Initial ledger state
 * @param transactions - Transactions to process (each with assigned strictness)
 * @param blockTime - Block timestamp
 * @param blockContext - Block context
 * @param fullness - Block fullness (0-1)
 */
export const processTransactions = (
  ledger: LedgerState,
  transactions: readonly ReadyTransaction[],
  blockTime: Date,
  blockContext: BlockContext,
  fullness: number,
): Either.Either<{ blockTransactions: readonly BlockTransaction[]; finalLedger: LedgerState }, LedgerOps.LedgerError> =>
  transactions.reduce<
    Either.Either<{ blockTransactions: readonly BlockTransaction[]; finalLedger: LedgerState }, LedgerOps.LedgerError>
  >(
    (acc, readyTx) =>
      Either.flatMap(acc, ({ blockTransactions, finalLedger }) =>
        Either.map(processTransaction(finalLedger, readyTx, blockTime, blockContext, fullness), (result) => ({
          blockTransactions: [...blockTransactions, { tx: result.tx, result: result.result }],
          finalLedger: result.newLedger,
        })),
      ),
    Either.right({ blockTransactions: [], finalLedger: ledger }),
  );

/**
 * Create a block from processed transactions and update state. Pure function that takes pre-computed block hash.
 *
 * @param state - Current simulator state
 * @param blockTransactions - Processed transactions to include
 * @param blockHash - Pre-computed block hash
 * @param blockTime - Block timestamp
 * @param newLedger - New ledger state after processing transactions
 * @param processedTxs - Ready transactions to remove from mempool
 */
export const createBlock = (
  state: SimulatorState,
  blockTransactions: readonly BlockTransaction[],
  blockHashValue: string,
  blockTime: Date,
  newLedger: LedgerState,
  processedTxs: readonly ReadyTransaction[],
): [Block, SimulatorState] => {
  const nextBlockNumber = getCurrentBlockNumber(state) + 1n;

  const block: Block = {
    number: nextBlockNumber,
    hash: blockHashValue,
    timestamp: blockTime,
    transactions: blockTransactions,
  };

  const txsToRemove = new Set(processedTxs.map((t) => t.tx));
  const newState: SimulatorState = {
    ...state,
    ledger: newLedger,
    blocks: [...state.blocks, block],
    mempool: state.mempool.filter((pending) => !txsToRemove.has(pending.tx)),
    currentTime: blockTime,
  };

  return [block, newState];
};

/**
 * Create an empty block (no transactions) and update state.
 *
 * @param state - Current simulator state
 * @param blockHashValue - Pre-computed block hash
 * @param blockTime - Block timestamp
 * @param processedTxs - Original pending transactions to remove from mempool (if any)
 */
export const createEmptyBlock = (
  state: SimulatorState,
  blockHashValue: string,
  blockTime: Date,
  processedTxs: readonly ReadyTransaction[] = [],
): [Block, SimulatorState] => {
  return createBlock(state, [], blockHashValue, blockTime, state.ledger, processedTxs);
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a WellFormedStrictness instance with configurable options. All options default to false for maximum testing
 * flexibility.
 *
 * Note: WellFormedStrictness is a class from the ledger library that requires mutation to configure. This is
 * unavoidable given the external API design.
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
 * Compute block hash from block number. Uses a deterministic hash based on block number for easy recomputation.
 *
 * @param blockNumber - The block number to compute hash for
 * @returns A deterministic 64-character hex hash
 */
export const blockHash = async (blockNumber: bigint): Promise<string> => {
  const input = `block-${blockNumber.toString()}`;
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const { Encoding } = await import('effect');
  return Encoding.encodeHex(new Uint8Array(hashBuffer));
};

/**
 * Create the next block context from the previous block.
 *
 * @param previousBlock - The previous block (or undefined for genesis)
 * @param blockTime - The timestamp for the new block
 * @returns A BlockContext suitable for transaction processing
 */
export const nextBlockContextFromBlock = async (
  previousBlock: Block | undefined,
  blockTime: Date,
): Promise<BlockContext> => {
  const nextBlockNumber = previousBlock !== undefined ? previousBlock.number + 1n : 0n;
  const hash = await blockHash(nextBlockNumber);
  const blockSeconds = DateOps.dateToSeconds(blockTime);
  const previousSeconds =
    previousBlock !== undefined ? DateOps.dateToSeconds(previousBlock.timestamp) : blockSeconds - 1n;
  const timeSinceLastBlock = blockSeconds - previousSeconds;

  return {
    parentBlockHash: hash,
    secondsSinceEpoch: blockSeconds,
    secondsSinceEpochErr: 1, // Clock error tolerance in seconds (reasonable default for simulator)
    lastBlockTime: timeSinceLastBlock > 0n ? timeSinceLastBlock : 1n,
  };
};
