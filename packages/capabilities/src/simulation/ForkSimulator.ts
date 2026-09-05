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
 * Ledger-v8 the chain runs on ledger-v8, ledger-v9 on ledger-v9, with real ledger bytes on both sides — enough for a
 * wallet under test to observe the version change, migrate, and go on transacting.
 */

import { Deferred, Effect, Option, pipe, Scope, Stream, SubscriptionRef, type Array as Arr } from 'effect';
import { LedgerState } from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';

import { LedgerTranslationError, type LedgerStateTranslator } from './LedgerTranslation.js';
import { Simulator } from './v9/Simulator.js';
import { blankState, updateLedger, type BlockProducer } from './v9/SimulatorState.js';
import * as V8 from './v8/index.js';

// =============================================================================
// Configuration
// =============================================================================

/** {@link ForkSimulator} initialization configuration. */
export type ForkSimulatorConfig = Readonly<{
  /**
   * Height at which the chain forks.
   *
   * The ledger-v8 chain's block at this height is a ledger-v8 block stamped with {@link forkVersion} — the signal a
   * wallet's V1 variant migrates on, which it observes but does not apply. The ledger-v9 chain then begins at the same
   * height, re-delivering it with ledger-v9 content, mirroring a wallet re-fetching the boundary with its new codec.
   */
  forkBlock: bigint;
  /**
   * Protocol version the fork activates.
   *
   * Required, and never defaulted: the protocol version of the real fork is not final, so every caller states which
   * version it means.
   */
  forkVersion: ProtocolVersion.ProtocolVersion;
  /**
   * How the ledger-v8 chain's ledger state becomes the ledger-v9 chain's starting point.
   *
   * Receives the final ledger-v8 state, serialized, and returns the ledger-v9 one. See {@link LedgerStateTranslator} for
   * why the seam is stated in bytes rather than state objects.
   */
  translator: LedgerStateTranslator;
  /** Protocol version the ledger-v8 chain runs on. Defaults to {@link ProtocolVersion.MinSupportedVersion}. */
  v8Version?: ProtocolVersion.ProtocolVersion;
  /** Network identifier, shared by both chains. Defaults to Undeployed. */
  networkId?: NetworkId.NetworkId;
  /** Pre-funded accounts on the ledger-v8 chain. */
  v8GenesisMints?: Arr.NonEmptyArray<V8.GenesisMint>;
  /** Block producer for the ledger-v8 chain. */
  v8BlockProducer?: V8.BlockProducer;
  /** Block producer for the ledger-v9 chain. */
  v9BlockProducer?: BlockProducer;
}>;

// =============================================================================
// Fork Simulator
// =============================================================================

/**
 * A simulated chain that crosses a hard fork, built from the two simulator twins.
 *
 * The ledger-v8 chain is available immediately and is driven like any other simulator. Once it reaches
 * {@link ForkSimulatorConfig.forkBlock} the handover runs and the ledger-v9 chain appears; both remain alive for the
 * simulator's scope, so assertions can read either side of the boundary.
 *
 * Nothing stops the ledger-v8 chain producing blocks past the boundary, which a real chain could not do — drive it only
 * up to the fork.
 *
 * @example
 *   ```typescript
 *   const fork = yield* ForkSimulator.init({
 *     forkBlock: 3n,
 *     forkVersion: ProtocolVersion.ProtocolVersion(7n),
 *     v8GenesisMints: [{ type: 'shielded', tokenType, amount: 1_000n, recipient: v8Keys }],
 *     translator: translatorFromAsync(translateLedgerState),
 *   });
 *
 *   yield* fork.v8.submitTransaction(v8Transfer);
 *   const v9 = yield* fork.advanceToFork();
 *   yield* v9.submitTransaction(v9Transfer);
 *   ```;
 */
export class ForkSimulator {
  // ===========================================================================
  // Static Methods
  // ===========================================================================

  /**
   * Initialize a forking chain. The ledger-v8 chain starts immediately with the fork already scheduled; the ledger-v9
   * chain is constructed when the ledger-v8 chain reaches the fork block.
   *
   * @param config - Configuration options
   * @returns Effect that produces a ForkSimulator
   */
  static init(config: ForkSimulatorConfig): Effect.Effect<ForkSimulator, never, Scope.Scope> {
    return Effect.gen(function* () {
      const networkId = config.networkId ?? NetworkId.NetworkId.Undeployed;
      const v8Version = config.v8Version ?? ProtocolVersion.MinSupportedVersion;

      const v8 = yield* V8.Simulator.init({
        networkId,
        protocolVersion: v8Version,
        ...(config.v8GenesisMints !== undefined ? { genesisMints: config.v8GenesisMints } : {}),
        ...(config.v8BlockProducer !== undefined ? { blockProducer: config.v8BlockProducer } : {}),
      });

      // Scheduled up front, so the boundary block carries the fork version however the chain is driven to it.
      yield* v8.scheduleFork(config.forkBlock, config.forkVersion);

      const v9Ref = yield* SubscriptionRef.make(Option.none<Simulator>());
      const v9Ready = yield* Deferred.make<Simulator, LedgerTranslationError>();

      const forkSimulator = new ForkSimulator(config, networkId, v8, v9Ref, v9Ready);

      // The handover must outlive the watcher fiber, so it is built in the simulator's own scope.
      const scope = yield* Effect.scope;

      const runHandover = Effect.gen(function* () {
        const atFork = yield* forkSimulator.#awaitForkBlock();
        const v9 = yield* Scope.extend(
          // Suspended so that a handover built from a throwing caller-supplied callback fails this effect rather than
          // escaping as a synchronous exception.
          Effect.suspend(() => forkSimulator.#handover(atFork)),
          scope,
        );
        // The reference is set first: anything woken by the deferred must already see the ledger-v9 chain.
        yield* SubscriptionRef.set(v9Ref, Option.some(v9));
        return v9;
      });

      // The handover runs detached, so its outcome has to be handed to whoever is waiting for the fork — including when
      // it fails or dies. `intoDeferred` transfers the whole exit; completing the deferred by hand on the success path
      // only would leave every waiter blocked forever on a broken handover, which reads as a hang rather than an error.
      yield* Effect.forkScoped(Effect.intoDeferred(runHandover, v9Ready));

      return forkSimulator;
    });
  }

  // ===========================================================================
  // Instance Properties
  // ===========================================================================

  readonly #config: ForkSimulatorConfig;
  readonly #networkId: NetworkId.NetworkId;
  readonly #v9Ref: SubscriptionRef.SubscriptionRef<Option.Option<Simulator>>;
  readonly #v9Ready: Deferred.Deferred<Simulator, LedgerTranslationError>;

  /** The ledger-v8 chain. */
  readonly v8: V8.Simulator;

  /** Height at which the chain forks. */
  readonly forkBlock: bigint;

  /** Protocol version the fork activates. */
  readonly forkVersion: ProtocolVersion.ProtocolVersion;

  private constructor(
    config: ForkSimulatorConfig,
    networkId: NetworkId.NetworkId,
    v8: V8.Simulator,
    v9Ref: SubscriptionRef.SubscriptionRef<Option.Option<Simulator>>,
    v9Ready: Deferred.Deferred<Simulator, LedgerTranslationError>,
  ) {
    this.#config = config;
    this.#networkId = networkId;
    this.#v9Ref = v9Ref;
    this.#v9Ready = v9Ready;
    this.v8 = v8;
    this.forkBlock = config.forkBlock;
    this.forkVersion = config.forkVersion;
  }

  // ===========================================================================
  // Instance Methods
  // ===========================================================================

  /**
   * The ledger-v9 chain, if the fork has happened.
   *
   * @returns `Option.some` once the handover has completed, `Option.none` before
   */
  v9(): Effect.Effect<Option.Option<Simulator>> {
    return SubscriptionRef.get(this.#v9Ref);
  }

  /**
   * Wait until the fork has happened, however the ledger-v8 chain is driven to it.
   *
   * Fails with the handover's own failure if it could not produce a ledger-v9 chain, so a broken handover surfaces here
   * rather than leaving waiters blocked forever.
   *
   * @returns The ledger-v9 chain
   */
  awaitV9(): Effect.Effect<Simulator, LedgerTranslationError> {
    return Deferred.await(this.#v9Ready);
  }

  /**
   * Drive the ledger-v8 chain to the fork block with empty blocks and wait for the handover.
   *
   * Blocks the chain has already produced count towards the boundary, so this composes with transaction-driven
   * production: submit what the test needs, then advance the rest of the way.
   *
   * @returns The ledger-v9 chain
   */
  advanceToFork(): Effect.Effect<Simulator, LedgerOps.LedgerError | LedgerTranslationError> {
    const v8 = this.v8;
    const forkBlock = this.forkBlock;

    const driveToForkBlock = (): Effect.Effect<void, LedgerOps.LedgerError> =>
      Effect.gen(function* () {
        const state = yield* v8.getLatestState();
        if (V8.getCurrentBlockNumber(state) >= forkBlock) return;
        yield* v8.produceEmptyBlock();
        yield* driveToForkBlock();
      });

    return pipe(
      driveToForkBlock(),
      Effect.flatMap(() => this.awaitV9()),
    );
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * Resolve once the ledger-v8 chain has reached the fork block, with the state at that point.
   *
   * The current state is checked before subscribing, and the ledger-v8 chain's shared state stream replays its latest
   * value to new subscribers, so the boundary cannot slip past between the two.
   */
  #awaitForkBlock(): Effect.Effect<V8.SimulatorState> {
    const v8 = this.v8;
    const forkBlock = this.forkBlock;

    return Effect.gen(function* () {
      const current = yield* v8.getLatestState();
      if (V8.getCurrentBlockNumber(current) >= forkBlock) return current;

      const reached = yield* pipe(
        v8.state$,
        Stream.filter((state) => V8.getCurrentBlockNumber(state) >= forkBlock),
        Stream.take(1),
        Stream.runHead,
      );

      return yield* Option.match(reached, {
        onNone: () => Effect.die(new Error('Ledger-v8 state stream ended before reaching the fork block')),
        onSome: Effect.succeed,
      });
    });
  }

  /** Run the handover and construct the ledger-v9 chain, numbered and timed to continue from the fork point. */
  #handover(v8State: V8.SimulatorState): Effect.Effect<Simulator, LedgerTranslationError, Scope.Scope> {
    const { forkVersion, forkBlock, v9BlockProducer } = this.#config;
    const networkId = this.#networkId;
    // The ledger-v9 chain resumes the ledger-v8 chain's height and clock, so the boundary is re-delivered rather than
    // restarted. `blankState` takes the network id positionally, so it is not part of this.
    const genesis = {
      protocolVersion: forkVersion,
      genesisBlockNumber: forkBlock,
      genesisTime: v8State.currentTime,
    };

    /** A ledger-v9 chain whose genesis block already holds the given ledger, rather than one built by minting into it. */
    const chainStartingFrom = (ledger: LedgerState): Effect.Effect<Simulator, never, Scope.Scope> =>
      pipe(
        Effect.promise(() => blankState(networkId, genesis)),
        Effect.map((state) => updateLedger(state, ledger)),
        Effect.flatMap((state) => Simulator.fromState(state, v9BlockProducer)),
      );

    return pipe(
      this.#config.translator(v8State.ledger.serialize()),
      // Deserializing is the harness's job, not the translator's, so bytes ledger-v9 rejects are a
      // translation failure rather than a crash out of the handover fiber.
      Effect.flatMap((translated) =>
        Effect.try({
          try: () => LedgerState.deserialize(translated),
          catch: (cause) =>
            new LedgerTranslationError({
              message: 'Translated bytes are not a valid ledger-v9 state',
              cause,
            }),
        }),
      ),
      Effect.flatMap(chainStartingFrom),
    );
  }
}
