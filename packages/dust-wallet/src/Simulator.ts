// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { Effect, Either, Encoding, pipe, Scope, Stream, SubscriptionRef } from 'effect';
import {
  LedgerState,
  BlockContext,
  UserAddress,
  ClaimRewardsTransaction,
  SignatureErased,
  SignatureVerifyingKey,
  Transaction,
  WellFormedStrictness,
  TransactionResult,
  TransactionContext,
  ProofErasedTransaction,
  SyntheticCost,
} from '@midnight-ntwrk/ledger-v7';
import { DateOps, EitherOps, LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import * as crypto from 'crypto';
import { NetworkId } from './types/ledger.js';

export type SimulatorState = Readonly<{
  networkId: NetworkId;
  ledger: LedgerState;
  lastTx: ProofErasedTransaction | undefined;
  lastTxResult: TransactionResult | undefined;
  lastTxNumber: bigint;
}>;

const simpleHash = (input: string): Effect.Effect<string> => {
  return Encoding.decodeHex(input).pipe(
    EitherOps.toEffect,
    Effect.andThen((parsed) => Effect.promise(() => crypto.subtle.digest('SHA-256', parsed))),
    Effect.andThen((out) => Encoding.encodeHex(new Uint8Array(out))),
    Effect.orDie,
  );
};

export class Simulator {
  static blockHash = (blockTime: Date): Effect.Effect<string> =>
    pipe(
      DateOps.dateToSeconds(blockTime).toString(16),
      (str) => (str.length % 2 == 0 ? str : str.padStart(str.length + 1, '0')),
      simpleHash,
    );

  static nextBlockContext = (blockTime: Date): Effect.Effect<BlockContext> =>
    pipe(
      Simulator.blockHash(blockTime),
      Effect.map((hash) => ({
        parentBlockHash: hash,
        secondsSinceEpoch: DateOps.dateToSeconds(blockTime),
        secondsSinceEpochErr: 1,
      })),
    );

  static init(networkId: NetworkId): Effect.Effect<Simulator, never, Scope.Scope> {
    return Effect.gen(function* () {
      const initialState = {
        networkId,
        ledger: LedgerState.blank(networkId),
        lastTx: undefined,
        lastTxResult: undefined,
        lastTxNumber: 0n,
      };
      const ref = yield* SubscriptionRef.make<SimulatorState>(initialState);
      const changesStream = yield* Stream.share(ref.changes, {
        capacity: 'unbounded',
        replay: Number.MAX_SAFE_INTEGER,
      });
      yield* pipe(changesStream, Stream.runDrain, Effect.forkScoped);
      return new Simulator(ref, changesStream);
    });
  }

  static apply(
    simulatorState: SimulatorState,
    tx: ProofErasedTransaction,
    strictness: WellFormedStrictness,
    blockContext: BlockContext,
    blockFullness?: SyntheticCost,
  ): Either.Either<[{ blockNumber: bigint; blockHash: string }, SimulatorState], LedgerOps.LedgerError> {
    return LedgerOps.ledgerTry(() => {
      blockFullness = blockFullness ?? tx.cost(simulatorState.ledger.parameters);

      const detailedBlockFullness = simulatorState.ledger.parameters.normalizeFullness(blockFullness);
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

      const newSimulatorState = {
        ...simulatorState,
        ledger: newLedgerState.postBlockUpdate(blockTime, detailedBlockFullness, computedBlockFullness),
        lastTx: tx,
        lastTxResult: txResult,
        lastTxNumber: blockNumber,
      };

      const output = {
        blockNumber,
        blockHash: blockContext.parentBlockHash,
      };

      return [output, newSimulatorState];
    });
  }

  readonly #stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>;

  readonly state$: Stream.Stream<SimulatorState>;

  constructor(stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>, state$: Stream.Stream<SimulatorState>) {
    this.#stateRef = stateRef;
    this.state$ = state$;
  }

  getLatestState(): Effect.Effect<SimulatorState> {
    return SubscriptionRef.get(this.#stateRef);
  }

  rewardNight(
    recipient: UserAddress,
    amount: bigint,
    verifyingKey: SignatureVerifyingKey,
  ): Effect.Effect<{ blockNumber: bigint; blockHash: string }, LedgerOps.LedgerError> {
    return SubscriptionRef.modifyEffect(this.#stateRef, (simulatorState) =>
      Effect.gen(function* () {
        const nextNumber = DateOps.secondsToDate(simulatorState.lastTxNumber + 1n);
        const newLedgerState = yield* LedgerOps.ledgerTry(() =>
          simulatorState.ledger.testingDistributeNight(recipient, amount, nextNumber),
        );
        const newSimulatorState = {
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

  submitRegularTx(
    tx: ProofErasedTransaction,
    blockFullness?: SyntheticCost,
  ): Effect.Effect<{ blockNumber: bigint; blockHash: string }, LedgerOps.LedgerError> {
    return SubscriptionRef.modifyEffect(this.#stateRef, (simulatorState) =>
      Effect.gen(function* () {
        const nextNumber = DateOps.secondsToDate(simulatorState.lastTxNumber + 1n);
        const context = yield* Simulator.nextBlockContext(nextNumber);
        return yield* Simulator.apply(simulatorState, tx, new WellFormedStrictness(), context, blockFullness);
      }),
    );
  }

  fastForward(lastTxNumber: bigint): Effect.Effect<undefined, LedgerOps.LedgerError> {
    return SubscriptionRef.modify(this.#stateRef, (simulatorState) => {
      return [
        undefined,
        {
          ...simulatorState,
          lastTxNumber,
          lastTx: undefined,
          lastTxResult: undefined,
        },
      ];
    });
  }
}
