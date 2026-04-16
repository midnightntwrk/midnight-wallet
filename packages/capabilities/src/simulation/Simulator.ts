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
 * This module provides a simulated ledger environment for testing wallet functionality without requiring a real
 * blockchain node. It supports:
 *
 * - Optional genesis mints for pre-funded accounts (shielded, unshielded, or Night tokens)
 * - Transaction submission with configurable strictness
 * - Night token rewards via rewardNight()
 * - Time advancement for TTL and time-sensitive tests
 */

import { Array as Arr, Effect, Either, pipe, type Scope, Stream, SubscriptionRef } from 'effect';
import {
  addressFromKey,
  ClaimRewardsTransaction,
  createShieldedCoinInfo,
  Intent,
  LedgerState,
  nativeToken,
  type PreBinding,
  type PreProof,
  type ProofErasedTransaction,
  type SignatureEnabled,
  SignatureErased,
  type SignatureVerifyingKey,
  Transaction,
  TransactionContext,
  type TransactionResult,
  UnshieldedOffer,
  type UserAddress,
  ZswapOffer,
  ZswapOutput,
} from '@midnight-ntwrk/ledger-v8';
import { DateOps, LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

import {
  addToMempool,
  allMempoolTransactions,
  blankState,
  type Block,
  blockHash,
  type BlockProducer,
  type BlockProductionRequest,
  createBlock,
  createEmptyBlock,
  createStrictness,
  defaultStrictness,
  type FullnessSpec,
  type GenesisMint,
  genesisStrictness,
  getLastBlock,
  hasPendingTransactions,
  nextBlockContextFromBlock,
  type PendingTransaction,
  processTransactions,
  removeFromMempool,
  resolveFullness,
  type ShieldedGenesisMint,
  type SimulatorState,
  type StrictnessConfig,
  type UnshieldedGenesisMint,
} from './SimulatorState.js';

// =============================================================================
// Type Guards and Helpers for Genesis Mints
// =============================================================================

/** Type guard for shielded genesis mint. */
const isShieldedMint = (mint: GenesisMint): mint is ShieldedGenesisMint => mint.type === 'shielded';

/** Type guard for unshielded genesis mint. */
const isUnshieldedMint = (mint: GenesisMint): mint is UnshieldedGenesisMint => mint.type === 'unshielded';

/**
 * Check if an unshielded mint is for the native Night token. Night is auto-detected by comparing tokenType with
 * ledger.nativeToken().raw.
 */
const isNightToken = (tokenType: string): boolean => tokenType === nativeToken().raw;

// Re-export types from SimulatorState for backward compatibility
export type {
  SimulatorState,
  Block,
  BlockTransaction,
  PendingTransaction,
  BlockInfo,
  BlockProductionRequest,
  BlockProducer,
  FullnessSpec,
  GenesisMint,
  StrictnessConfig,
} from './SimulatorState.js';

// Re-export state accessors for backward compatibility
export {
  getLastBlock,
  getCurrentBlockNumber,
  getBlockByNumber,
  getLastBlockResults,
  getLastBlockEvents,
  hasPendingTransactions,
  getCurrentTime,
  applyTransaction,
  defaultStrictness,
  genesisStrictness,
  createStrictness,
} from './SimulatorState.js';

// =============================================================================
// Block Producers
// =============================================================================

/**
 * Default block producer: produces a block for each state change with non-empty mempool.
 *
 * By default, uses post-genesis strictness (balancing, signatures, limits enforced). This ensures realistic simulation
 * where transactions must be properly balanced (pay fees).
 *
 * @param fullness - Static fullness (0-1) or callback based on state
 * @param strictness - Strictness config (defaults to defaultStrictness)
 */
export const immediateBlockProducer =
  (fullness: FullnessSpec = 0.5, strictness: StrictnessConfig = defaultStrictness): BlockProducer =>
  (states) =>
    states.pipe(
      Stream.filter(hasPendingTransactions),
      Stream.map((s) => allMempoolTransactions(s, resolveFullness(fullness, s), createStrictness(strictness))),
    );

// =============================================================================
// Simulator Configuration
// =============================================================================

/** Simulator initialization configuration. */
export type SimulatorConfig = Readonly<{
  /**
   * Pre-funded accounts to create at genesis. When provided, creates a genesis block with transactions minting tokens
   * to recipients. When omitted, the simulator starts with an empty ledger.
   */
  genesisMints?: Arr.NonEmptyArray<GenesisMint>;
  /** Network identifier. Defaults to Undeployed. */
  networkId?: NetworkId.NetworkId;
  /** Custom block producer. Defaults to immediateBlockProducer(). */
  blockProducer?: BlockProducer;
}>;

// =============================================================================
// Simulator Class
// =============================================================================

/**
 * Unified simulator for wallet testing.
 *
 * Provides a simulated ledger environment for testing wallet functionality without a real blockchain. Optionally
 * pre-funds accounts via genesis mints.
 *
 * @example
 *   ```typescript
 *   // Empty ledger (useful for dust/Night token testing via rewardNight)
 *   const simulator = yield* Simulator.init({});
 *
 *   // Pre-funded accounts (useful for token transfer testing)
 *   const simulator = yield* Simulator.init({
 *     genesisMints: [{ amount: 1000n, tokenType, shieldedRecipient: secretKeys }],
 *   });
 *   ```;
 */
export class Simulator {
  // ===========================================================================
  // Static Methods
  // ===========================================================================

  /**
   * Initialize a new simulator.
   *
   * @example
   *   ```typescript
   *   // Empty ledger - use rewardNight() for Night tokens
   *   const simulator = yield* Simulator.init({});
   *
   *   // Pre-funded accounts for token transfer testing
   *   const simulator = yield* Simulator.init({
   *     genesisMints: [{ amount: 1000n, tokenType, shieldedRecipient: secretKeys }],
   *   });
   *
   *   // With custom network ID
   *   const simulator = yield* Simulator.init({
   *     networkId: NetworkId.Preview,
   *     genesisMints: [...],
   *   });
   *   ```;
   *
   * @param config - Configuration options (all optional)
   * @returns Effect that produces a Simulator instance
   */
  static init(config: SimulatorConfig = {}): Effect.Effect<Simulator, never, Scope.Scope> {
    const networkId = config.networkId ?? NetworkId.NetworkId.Undeployed;
    return config.genesisMints !== undefined && config.genesisMints.length > 0
      ? Simulator.initWithGenesis(config.genesisMints, networkId, config.blockProducer)
      : Simulator.initBlank(networkId, config.blockProducer);
  }

  /** Initialize simulator with blank ledger state. */
  private static initBlank(
    networkId: NetworkId.NetworkId,
    blockProducer?: BlockProducer,
  ): Effect.Effect<Simulator, never, Scope.Scope> {
    return pipe(
      Effect.promise(() => blankState(networkId)),
      Effect.flatMap((state) => Simulator.fromState(state, blockProducer)),
    );
  }

  /**
   * Initialize simulator with genesis mints (pre-funded accounts). Supports shielded and unshielded token mints. Night
   * tokens are auto-detected by comparing tokenType with nativeToken().raw.
   */
  private static initWithGenesis(
    genesisMints: Arr.NonEmptyArray<GenesisMint>,
    networkId: NetworkId.NetworkId = NetworkId.NetworkId.Undeployed,
    blockProducer?: BlockProducer,
  ): Effect.Effect<Simulator, never, Scope.Scope> {
    const noStrictness = createStrictness();

    // Pure function to extract shielded mint data (returns array for flatMap)
    const toShieldedMint = (mint: GenesisMint) =>
      isShieldedMint(mint) ? [{ tokenType: mint.tokenType, amount: mint.amount, keys: mint.recipient }] : [];

    // Pure function to extract non-Night unshielded mint data (returns array for flatMap)
    // Night is auto-detected by tokenType and excluded from regular unshielded minting
    const toCustomUnshieldedMint = (mint: GenesisMint) =>
      isUnshieldedMint(mint) && !isNightToken(mint.tokenType)
        ? [{ tokenType: mint.tokenType, amount: mint.amount, recipient: mint.recipient }]
        : [];

    // Pure function to extract Night mint data from unshielded mints (returns array for flatMap)
    // Night is auto-detected by comparing tokenType with nativeToken().raw
    const toNightMint = (mint: GenesisMint) =>
      isUnshieldedMint(mint) && isNightToken(mint.tokenType) && mint.verifyingKey !== undefined
        ? [{ amount: mint.amount, recipient: mint.recipient, verifyingKey: mint.verifyingKey }]
        : [];

    // Pure function to create a ZswapOffer from shielded mint data
    const createShieldedOffer = (transfer: {
      tokenType: string;
      amount: bigint;
      keys: import('@midnight-ntwrk/ledger-v8').ZswapSecretKeys;
    }): ZswapOffer<PreProof> => {
      const coin = createShieldedCoinInfo(transfer.tokenType, transfer.amount);
      const output = ZswapOutput.new(coin, 0, transfer.keys.coinPublicKey, transfer.keys.encryptionPublicKey);
      return ZswapOffer.fromOutput<PreProof>(output, transfer.tokenType, transfer.amount);
    };

    // Pure function to create an Intent with UnshieldedOffer
    // Note: Intent API requires mutation, isolated here
    const createUnshieldedIntent = (
      mints: ReadonlyArray<{ tokenType: string; amount: bigint; recipient: UserAddress }>,
      ttl: Date,
    ): Intent<SignatureEnabled, PreProof, PreBinding> => {
      const outputs = mints.map((mint) => ({ type: mint.tokenType, value: mint.amount, owner: mint.recipient }));
      const intent = Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = UnshieldedOffer.new([], outputs, []);
      return intent;
    };

    // Process shielded and custom unshielded mints in initial block (Night handled separately)
    const makeInitialTransactions = (
      ledgerState: LedgerState,
      context: import('@midnight-ntwrk/ledger-v8').BlockContext,
      blockTime: Date,
    ) => {
      const verificationTime = blockTime;

      // Separate mints by type using flatMap (pure, no mutation)
      // Night tokens are excluded and handled separately via reward/claim mechanism
      const shieldedMints = genesisMints.flatMap(toShieldedMint);
      const customUnshieldedMints = genesisMints.flatMap(toCustomUnshieldedMint);

      // If no shielded or custom unshielded mints, return empty result
      if (shieldedMints.length === 0 && customUnshieldedMints.length === 0) {
        return {
          initialState: ledgerState,
          transactions: [] as readonly { tx: ProofErasedTransaction; result: TransactionResult }[],
        };
      }

      // Create ZswapOffer for shielded mints (if any)
      const zswapOffer: ZswapOffer<PreProof> | undefined =
        shieldedMints.length > 0
          ? shieldedMints.map(createShieldedOffer).reduce((acc, offer) => acc.merge(offer))
          : undefined;

      // Create Intent with UnshieldedOffer for custom unshielded mints (if any)
      const ttl = new Date(blockTime.getTime() + 3600 * 1000); // 1 hour TTL from block time
      const intent = customUnshieldedMints.length > 0 ? createUnshieldedIntent(customUnshieldedMints, ttl) : undefined;

      // Build transaction from parts
      const proofErasedTx = Transaction.fromParts(networkId, zswapOffer, undefined, intent).eraseProofs();
      const verifiedTx = proofErasedTx.wellFormed(ledgerState, noStrictness, verificationTime);
      const [newState, result] = ledgerState.apply(verifiedTx, new TransactionContext(ledgerState, context));

      return {
        initialState: newState,
        transactions: [{ tx: proofErasedTx, result }] as const,
      };
    };

    // Process a single Night mint by distributing Night and creating claim transaction
    const processNightMint = (
      ledgerState: LedgerState,
      mint: { amount: bigint; recipient: UserAddress; verifyingKey: SignatureVerifyingKey },
      blockTime: Date,
      context: import('@midnight-ntwrk/ledger-v8').BlockContext,
    ): { ledgerState: LedgerState; tx: ProofErasedTransaction; result: TransactionResult } => {
      // Distribute Night tokens (makes them claimable)
      const ledgerWithReward = ledgerState.testingDistributeNight(mint.recipient, mint.amount, blockTime);

      // Create claim transaction
      const signature = new SignatureErased();
      const claimTx = new ClaimRewardsTransaction(
        signature.instance,
        networkId,
        mint.amount,
        mint.verifyingKey,
        LedgerOps.randomNonce(),
        signature,
      );
      const proofErasedTx = Transaction.fromRewards(claimTx).eraseProofs();
      const verifiedTx = proofErasedTx.wellFormed(ledgerWithReward, noStrictness, blockTime);
      const [newState, result] = ledgerWithReward.apply(verifiedTx, new TransactionContext(ledgerWithReward, context));

      return { ledgerState: newState, tx: proofErasedTx, result };
    };

    return Effect.gen(function* () {
      const genesisTime = new Date(0);
      const emptyState = LedgerState.blank(networkId);
      const context = yield* Effect.promise(() => nextBlockContextFromBlock(undefined, genesisTime));

      // Process shielded and unshielded mints first
      const init = makeInitialTransactions(emptyState, context, genesisTime);

      // Apply post-block update before processing Night mints
      // Night distribution requires the ledger to be in a consistent post-block state
      const postBlockState = init.initialState.postBlockUpdate(genesisTime);

      // Process Night mints sequentially using reduce (pure functional fold)
      const nightMints = genesisMints.flatMap(toNightMint);
      const nightResults = nightMints.reduce(
        (acc, mint) => {
          const result = processNightMint(acc.ledgerState, mint, genesisTime, context);
          return {
            ledgerState: result.ledgerState,
            transactions: [...acc.transactions, { tx: result.tx, result: result.result }],
          };
        },
        {
          ledgerState: postBlockState,
          transactions: [] as readonly { tx: ProofErasedTransaction; result: TransactionResult }[],
        },
      );

      // Apply final post-block update
      const finalLedger = nightResults.ledgerState.postBlockUpdate(genesisTime);

      // Combine all transactions
      const allTransactions = [...init.transactions, ...nightResults.transactions];

      // Create genesis block with all transactions
      const genesisBlock: Block = {
        number: 0n,
        hash: context.parentBlockHash,
        timestamp: genesisTime,
        transactions: allTransactions,
      };

      const initialState: SimulatorState = {
        networkId,
        ledger: finalLedger,
        blocks: [genesisBlock],
        mempool: [],
        currentTime: genesisTime, // Time stays at genesis; next block will advance it
      };
      return yield* Simulator.fromState(initialState, blockProducer);
    });
  }

  /** Create a Simulator from an initial state with proper stream setup. */
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
        productionRequests.pipe(Stream.runForEach((request) => simulator.#produceBlock(request))),
      );

      return simulator;
    });
  }

  // ===========================================================================
  // Instance Properties
  // ===========================================================================

  readonly #stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>;

  /** Observable stream of simulator state changes. */
  readonly state$: Stream.Stream<SimulatorState>;

  constructor(stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>, state$: Stream.Stream<SimulatorState>) {
    this.#stateRef = stateRef;
    this.state$ = state$;
  }

  // ===========================================================================
  // Instance Methods
  // ===========================================================================

  /** Get the current simulator state. */
  getLatestState(): Effect.Effect<SimulatorState> {
    return SubscriptionRef.get(this.#stateRef);
  }

  /**
   * Distribute Night tokens to a recipient and submit claim transaction to mempool. Used for testing dust token
   * generation.
   *
   * This method:
   *
   * 1. Modifies the ledger to make Night tokens claimable
   * 2. Creates and submits a ClaimRewardsTransaction to the mempool
   * 3. The block producer will process the transaction
   *
   * @param verifyingKey - Signature verifying key (recipient address is derived from it)
   * @param amount - Amount of Night tokens to distribute
   */
  rewardNight(verifyingKey: SignatureVerifyingKey, amount: bigint): Effect.Effect<Block, LedgerOps.LedgerError> {
    const stateRef = this.#stateRef;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const simulator = this;
    const recipient = addressFromKey(verifyingKey);

    return Effect.gen(function* () {
      // First, modify ledger state to make Night tokens claimable
      yield* SubscriptionRef.updateEffect(stateRef, (simulatorState) =>
        pipe(
          LedgerOps.ledgerTry(() =>
            simulatorState.ledger.testingDistributeNight(recipient, amount, simulatorState.currentTime),
          ),
          Effect.map((newLedgerState) => ({
            ...simulatorState,
            ledger: newLedgerState,
          })),
        ),
      );

      // Create and submit the claim transaction through submitTransaction
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

      // Submit transaction with genesisStrictness - reward claims are not balanced transactions
      return yield* simulator.submitTransaction(tx, { strictness: genesisStrictness });
    });
  }

  /**
   * Submit a transaction and wait for it to be included in a block.
   *
   * This method adds the transaction to the mempool and blocks until the block producer includes it in a block. Use
   * this when you need confirmation that the transaction was processed.
   *
   * For fire-and-forget scenarios where you don't need to wait for block inclusion, use `submitAndForget` instead.
   *
   * @param tx - Transaction to submit (proofs erased)
   * @param options - Optional submission options
   * @param options.strictness - Override well-formedness strictness
   * @returns The block containing the transaction
   */
  submitTransaction(
    tx: ProofErasedTransaction,
    options?: { strictness?: StrictnessConfig },
  ): Effect.Effect<Block, LedgerOps.LedgerError> {
    // Only set strictness if explicitly provided; otherwise let block producer assign default
    const pendingTx: PendingTransaction =
      options?.strictness !== undefined ? { tx, strictness: createStrictness(options.strictness) } : { tx };
    const stateRef = this.#stateRef;

    return Effect.gen(function* () {
      // Add to mempool
      yield* SubscriptionRef.update(stateRef, (s) => addToMempool(s, pendingTx));

      // Wait for the transaction to be processed (removed from mempool)
      // by watching state changes
      const finalState = yield* pipe(
        stateRef.changes,
        Stream.filter((s) => !s.mempool.includes(pendingTx)),
        Stream.take(1),
        Stream.runHead,
      );

      if (finalState._tag === 'None') {
        return yield* Effect.die(new Error('State stream ended unexpectedly'));
      }

      // Find the block containing our transaction
      const block = finalState.value.blocks.find((b) => b.transactions.some((bt) => bt.tx === tx));

      if (!block) {
        // Transaction was removed from mempool but not in any block - it failed
        return yield* Effect.fail({
          _tag: 'LedgerError' as const,
          message: 'Transaction was discarded',
        } as LedgerOps.LedgerError);
      }

      return block;
    });
  }

  /**
   * Submit a transaction without waiting for block inclusion.
   *
   * This method adds the transaction to the mempool and returns immediately. The block producer will process it
   * asynchronously. Use this for fire-and-forget scenarios or when testing custom block producers with batched
   * transactions.
   *
   * To wait for block inclusion, use `submitTransaction` instead.
   *
   * @param tx - Transaction to submit (proofs erased)
   * @param options - Optional options
   * @param options.strictness - Override well-formedness strictness
   */
  submitAndForget(tx: ProofErasedTransaction, options?: { strictness?: StrictnessConfig }): Effect.Effect<void> {
    // Only set strictness if explicitly provided; otherwise let block producer assign default
    const pendingTx: PendingTransaction =
      options?.strictness !== undefined ? { tx, strictness: createStrictness(options.strictness) } : { tx };

    return SubscriptionRef.update(this.#stateRef, (s) => addToMempool(s, pendingTx));
  }

  /**
   * Fast-forward the simulator time by the given number of seconds. Does not produce a block - only advances the
   * internal clock. Useful for testing time-sensitive functionality like TTL.
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
   * Produce a block from the given block production request. Internal method used by the block producer stream.
   *
   * This method orchestrates block production by:
   *
   * 1. Computing the block hash (async)
   * 2. Processing transactions using pure functions from SimulatorState
   * 3. Creating the block and updating state atomically
   *
   * Each transaction in the request has its own strictness assigned by the block producer.
   *
   * @param request - Block production request with transactions and fullness
   */
  #produceBlock(request: BlockProductionRequest): Effect.Effect<Block, LedgerOps.LedgerError> {
    const stateRef = this.#stateRef;
    const { transactions, fullness } = request;

    return Effect.gen(function* () {
      const blockResult = yield* SubscriptionRef.modifyEffect(
        stateRef,
        (simulatorState): Effect.Effect<readonly [Either.Either<Block, LedgerOps.LedgerError>, SimulatorState]> =>
          Effect.gen(function* () {
            // Advance time first, then use it for the block
            const blockTime = DateOps.addSeconds(simulatorState.currentTime, 1);
            const previousBlock = getLastBlock(simulatorState);
            const nextBlockNumber = previousBlock !== undefined ? previousBlock.number + 1n : 0n;
            const hash = yield* Effect.promise(() => blockHash(nextBlockNumber));

            if (transactions.length === 0) {
              // No transactions to process, return empty block using pure function
              const [emptyBlock, newState] = createEmptyBlock(simulatorState, hash, blockTime, transactions);
              return [Either.right(emptyBlock), newState] as const;
            }

            const context = yield* Effect.promise(() => nextBlockContextFromBlock(previousBlock, blockTime));

            // Process all transactions - each has its own strictness assigned by block producer
            const processingResult = processTransactions(
              simulatorState.ledger,
              transactions,
              blockTime,
              context,
              fullness,
            );

            if (Either.isLeft(processingResult)) {
              // Transaction failed, remove from mempool and return error
              const newState = removeFromMempool(simulatorState, transactions);
              return [Either.left(processingResult.left), newState] as const;
            }

            const { blockTransactions, finalLedger } = processingResult.right;

            // Create block using pure function
            const [block, newState] = createBlock(
              simulatorState,
              blockTransactions,
              hash,
              blockTime,
              finalLedger,
              transactions,
            );

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
   * Query the simulator state with a custom function. This is a generic query mechanism that allows extracting any
   * information from the current state without modifying it.
   *
   * @example
   *   ```typescript
   *   // Query fee prices
   *   const feePrices = yield* simulator.query(state => state.ledger.parameters.feePrices);
   *
   *   // Use composable state accessors
   *   const blockNumber = yield* simulator.query(getCurrentBlockNumber);
   *   const lastBlock = yield* simulator.query(getLastBlock);
   *   const events = yield* simulator.query(getLastBlockEvents);
   *
   *   // Query UTXOs for an address
   *   const utxos = yield* simulator.query(state => Array.from(state.ledger.utxo.filter(address)));
   *
   *   // Complex query returning multiple values
   *   const info = yield* simulator.query(state => ({
   *     networkId: state.networkId,
   *     blockNumber: getCurrentBlockNumber(state),
   *     feePrices: state.ledger.parameters.feePrices,
   *   }));
   *   ```;
   *
   * @param fn - Function that receives the current state and returns a result
   * @returns The result of applying the function to the current state
   */
  query<T>(fn: (state: SimulatorState) => T): Effect.Effect<T> {
    return Effect.map(SubscriptionRef.get(this.#stateRef), fn);
  }
}
