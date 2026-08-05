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
 * A simulated chain that crosses a hard fork.
 *
 * Pre-fork the chain runs on ledger-v8, post-fork on ledger-v9, with real ledger bytes on both sides — enough for a
 * wallet under test to observe the version change, migrate, and go on transacting.
 */

import { Data, Deferred, Effect, Option, pipe, Scope, Stream, SubscriptionRef, type Array as Arr } from 'effect';
import { type LedgerState } from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';

import { Simulator } from './v9/Simulator.js';
import { blankState, updateLedger, type BlockProducer, type GenesisMint } from './v9/SimulatorState.js';
import * as V8 from './v8/index.js';

// =============================================================================
// Fork Handover
// =============================================================================

/**
 * How value crosses the fork boundary — the seam between the two chains.
 *
 * Both branches receive the final pre-fork state, complete with its ledger-v8 ledger, and produce the post-fork chain's
 * starting point. They exist because the mechanism is an open question: today a hard fork is expected to be crossed by
 * rebuilding state with the new ledger, but if the ledger team ships a v8-to-v9 state migration it becomes the other
 * branch, with nothing else about the harness changing.
 */
export type ForkHandover = Data.TaggedEnum<{
  /**
   * Recreate carried value on a fresh post-fork ledger, by minting it into the post-fork chain's genesis block.
   *
   * This is what a resync-style wallet migration expects to see: coin commitments are deterministic in the coin and the
   * owner's key, so re-minting identical coins reproduces identical commitments in the new chain's tree, and a wallet
   * replaying post-fork events with its own keys rediscovers them.
   */
  ReMint: {
    readonly mints: (preForkState: V8.SimulatorState) => Arr.NonEmptyArray<GenesisMint>;
  };
  /**
   * Convert the pre-fork ledger into a post-fork one, which the post-fork chain then starts from directly.
   *
   * The slot a ledger-provided v8-to-v9 state migration drops into.
   */
  MigrateLedger: {
    readonly convert: (preForkState: V8.SimulatorState) => LedgerState;
  };
}>;

/** Constructors and matchers for {@link ForkHandover}. */
export const ForkHandover = Data.taggedEnum<ForkHandover>();

// =============================================================================
// Configuration
// =============================================================================

/** {@link ForkSimulator} initialization configuration. */
export type ForkSimulatorConfig = Readonly<{
  /**
   * Height at which the chain forks.
   *
   * The pre-fork chain's block at this height is a ledger-v8 block stamped with {@link forkVersion} — the signal a
   * wallet's pre-fork variant migrates on, which it observes but does not apply. The post-fork chain then begins at the
   * same height, re-delivering it with ledger-v9 content, mirroring a wallet re-fetching the boundary with its new
   * codec.
   */
  forkBlock: bigint;
  /**
   * Protocol version the fork activates.
   *
   * Required, and never defaulted: the protocol version of the real fork is not final, so every caller states which
   * version it means.
   */
  forkVersion: ProtocolVersion.ProtocolVersion;
  /** How value crosses the boundary. */
  handover: ForkHandover;
  /** Protocol version the pre-fork chain runs on. Defaults to {@link ProtocolVersion.MinSupportedVersion}. */
  preForkVersion?: ProtocolVersion.ProtocolVersion;
  /** Network identifier, shared by both chains. Defaults to Undeployed. */
  networkId?: NetworkId.NetworkId;
  /** Pre-funded accounts on the pre-fork chain. */
  preForkGenesisMints?: Arr.NonEmptyArray<V8.GenesisMint>;
  /** Block producer for the pre-fork chain. */
  preForkBlockProducer?: V8.BlockProducer;
  /** Block producer for the post-fork chain. */
  postForkBlockProducer?: BlockProducer;
}>;

// =============================================================================
// Fork Simulator
// =============================================================================

/**
 * A simulated chain that crosses a hard fork, built from the two simulator twins.
 *
 * The pre-fork chain is available immediately and is driven like any other simulator. Once it reaches
 * {@link ForkSimulatorConfig.forkBlock} the handover runs and the post-fork chain appears; both remain alive for the
 * simulator's scope, so assertions can read either side of the boundary.
 *
 * Nothing stops the pre-fork chain producing blocks past the boundary, which a real chain could not do — drive it only
 * up to the fork.
 *
 * @example
 *   ```typescript
 *   const fork = yield* ForkSimulator.init({
 *     forkBlock: 3n,
 *     forkVersion: ProtocolVersion.ProtocolVersion(7n),
 *     preForkGenesisMints: [{ type: 'shielded', tokenType, amount: 1_000n, recipient: v8Keys }],
 *     handover: ForkHandover.ReMint({
 *       mints: () => [{ type: 'shielded', tokenType, amount: 1_000n, recipient: v9Keys }],
 *     }),
 *   });
 *
 *   yield* fork.preFork.submitTransaction(preForkTransfer);
 *   const postFork = yield* fork.advanceToFork();
 *   yield* postFork.submitTransaction(postForkTransfer);
 *   ```;
 */
export class ForkSimulator {
  // ===========================================================================
  // Static Methods
  // ===========================================================================

  /**
   * Initialize a forking chain. The pre-fork chain starts immediately with the fork already scheduled; the post-fork
   * chain is constructed when the pre-fork chain reaches the fork block.
   *
   * @param config - Configuration options
   * @returns Effect that produces a ForkSimulator
   */
  static init(config: ForkSimulatorConfig): Effect.Effect<ForkSimulator, never, Scope.Scope> {
    return Effect.gen(function* () {
      const networkId = config.networkId ?? NetworkId.NetworkId.Undeployed;
      const preForkVersion = config.preForkVersion ?? ProtocolVersion.MinSupportedVersion;

      const preFork = yield* V8.Simulator.init({
        networkId,
        protocolVersion: preForkVersion,
        ...(config.preForkGenesisMints !== undefined ? { genesisMints: config.preForkGenesisMints } : {}),
        ...(config.preForkBlockProducer !== undefined ? { blockProducer: config.preForkBlockProducer } : {}),
      });

      // Scheduled up front, so the boundary block carries the fork version however the chain is driven to it.
      yield* preFork.scheduleFork(config.forkBlock, config.forkVersion);

      const postForkRef = yield* SubscriptionRef.make(Option.none<Simulator>());
      const postForkReady = yield* Deferred.make<Simulator>();

      const forkSimulator = new ForkSimulator(config, networkId, preFork, postForkRef, postForkReady);

      // The handover must outlive the watcher fiber, so it is built in the simulator's own scope.
      const scope = yield* Effect.scope;

      const runHandover = Effect.gen(function* () {
        const atFork = yield* forkSimulator.#awaitForkBlock();
        const postFork = yield* Scope.extend(
          // Suspended so that a handover built from a throwing caller-supplied callback fails this effect rather than
          // escaping as a synchronous exception.
          Effect.suspend(() => forkSimulator.#handover(atFork)),
          scope,
        );
        // The reference is set first: anything woken by the deferred must already see the post-fork chain.
        yield* SubscriptionRef.set(postForkRef, Option.some(postFork));
        return postFork;
      });

      // The handover runs detached, so its outcome has to be handed to whoever is waiting for the fork — including when
      // it fails or dies. `intoDeferred` transfers the whole exit; completing the deferred by hand on the success path
      // only would leave every waiter blocked forever on a broken handover, which reads as a hang rather than an error.
      yield* Effect.forkScoped(Effect.intoDeferred(runHandover, postForkReady));

      return forkSimulator;
    });
  }

  // ===========================================================================
  // Instance Properties
  // ===========================================================================

  readonly #config: ForkSimulatorConfig;
  readonly #networkId: NetworkId.NetworkId;
  readonly #postForkRef: SubscriptionRef.SubscriptionRef<Option.Option<Simulator>>;
  readonly #postForkReady: Deferred.Deferred<Simulator>;

  /** The pre-fork (ledger-v8) chain. */
  readonly preFork: V8.Simulator;

  /** Height at which the chain forks. */
  readonly forkBlock: bigint;

  /** Protocol version the fork activates. */
  readonly forkVersion: ProtocolVersion.ProtocolVersion;

  private constructor(
    config: ForkSimulatorConfig,
    networkId: NetworkId.NetworkId,
    preFork: V8.Simulator,
    postForkRef: SubscriptionRef.SubscriptionRef<Option.Option<Simulator>>,
    postForkReady: Deferred.Deferred<Simulator>,
  ) {
    this.#config = config;
    this.#networkId = networkId;
    this.#postForkRef = postForkRef;
    this.#postForkReady = postForkReady;
    this.preFork = preFork;
    this.forkBlock = config.forkBlock;
    this.forkVersion = config.forkVersion;
  }

  // ===========================================================================
  // Instance Methods
  // ===========================================================================

  /**
   * The post-fork (ledger-v9) chain, if the fork has happened.
   *
   * @returns `Option.some` once the handover has completed, `Option.none` before
   */
  postFork(): Effect.Effect<Option.Option<Simulator>> {
    return SubscriptionRef.get(this.#postForkRef);
  }

  /**
   * Wait until the fork has happened, however the pre-fork chain is driven to it.
   *
   * @returns The post-fork chain
   */
  awaitPostFork(): Effect.Effect<Simulator> {
    return Deferred.await(this.#postForkReady);
  }

  /**
   * Drive the pre-fork chain to the fork block with empty blocks and wait for the handover.
   *
   * Blocks the chain has already produced count towards the boundary, so this composes with transaction-driven
   * production: submit what the test needs, then advance the rest of the way.
   *
   * @returns The post-fork chain
   */
  advanceToFork(): Effect.Effect<Simulator, LedgerOps.LedgerError> {
    const preFork = this.preFork;
    const forkBlock = this.forkBlock;

    const driveToForkBlock = (): Effect.Effect<void, LedgerOps.LedgerError> =>
      Effect.gen(function* () {
        const state = yield* preFork.getLatestState();
        if (V8.getCurrentBlockNumber(state) >= forkBlock) return;
        yield* preFork.produceEmptyBlock();
        yield* driveToForkBlock();
      });

    return pipe(
      driveToForkBlock(),
      Effect.flatMap(() => this.awaitPostFork()),
    );
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * Resolve once the pre-fork chain has reached the fork block, with the state at that point.
   *
   * The current state is checked before subscribing, and the pre-fork chain's shared state stream replays its latest
   * value to new subscribers, so the boundary cannot slip past between the two.
   */
  #awaitForkBlock(): Effect.Effect<V8.SimulatorState> {
    const preFork = this.preFork;
    const forkBlock = this.forkBlock;

    return Effect.gen(function* () {
      const current = yield* preFork.getLatestState();
      if (V8.getCurrentBlockNumber(current) >= forkBlock) return current;

      const reached = yield* pipe(
        preFork.state$,
        Stream.filter((state) => V8.getCurrentBlockNumber(state) >= forkBlock),
        Stream.take(1),
        Stream.runHead,
      );

      return yield* Option.match(reached, {
        onNone: () => Effect.die(new Error('Pre-fork state stream ended before reaching the fork block')),
        onSome: Effect.succeed,
      });
    });
  }

  /** Run the handover and construct the post-fork chain, numbered and timed to continue from the fork point. */
  #handover(preForkState: V8.SimulatorState): Effect.Effect<Simulator, never, Scope.Scope> {
    const { forkVersion, forkBlock, postForkBlockProducer } = this.#config;
    const networkId = this.#networkId;
    // Genesis parameters shared by both branches: the post-fork chain resumes the pre-fork chain's height and clock.
    const genesis = {
      networkId,
      protocolVersion: forkVersion,
      genesisBlockNumber: forkBlock,
      genesisTime: preForkState.currentTime,
      ...(postForkBlockProducer !== undefined ? { blockProducer: postForkBlockProducer } : {}),
    };

    return ForkHandover.$match(this.#config.handover, {
      ReMint: ({ mints }) => Simulator.init({ ...genesis, genesisMints: mints(preForkState) }),
      MigrateLedger: ({ convert }) =>
        pipe(
          Effect.promise(() =>
            blankState(networkId, {
              protocolVersion: forkVersion,
              genesisBlockNumber: forkBlock,
              genesisTime: preForkState.currentTime,
            }),
          ),
          Effect.map((state) => updateLedger(state, convert(preForkState))),
          Effect.flatMap((state) => Simulator.fromState(state, postForkBlockProducer)),
        ),
    });
  }
}
