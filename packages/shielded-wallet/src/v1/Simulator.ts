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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { Array as Arr, Effect, Encoding, pipe, type Scope, Stream, SubscriptionRef, Clock } from 'effect';
import { ArrayOps, EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import * as crypto from 'crypto';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

export type SimulatorState = Readonly<{
  ledger: ledger.LedgerState;
  lastTxResult: ledger.TransactionResult;
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

const wellFormedStrictness = (
  params: {
    enforceBalancing?: boolean;
    verifyNativeProofs?: boolean;
    verifyContractProofs?: boolean;
    enforceLimits?: boolean;
    verifySignatures?: boolean;
  } = {},
): ledger.WellFormedStrictness => {
  const strictness = new ledger.WellFormedStrictness();

  // Note: Enforce balancing should be true by default outside genesis mints
  strictness.enforceBalancing = params?.enforceBalancing ?? false;
  strictness.verifyNativeProofs = params?.verifyNativeProofs ?? false;
  strictness.verifyContractProofs = params?.verifyContractProofs ?? false;
  strictness.enforceLimits = params?.enforceLimits ?? false;
  strictness.verifySignatures = params?.verifySignatures ?? false;

  return strictness;
};

export class Simulator {
  static nextBlockContext = (number: bigint): Effect.Effect<ledger.BlockContext> =>
    pipe(
      number.toString(16),
      (str) => (str.length % 2 == 0 ? str : str.padStart(str.length + 1, '0')),
      simpleHash,
      Effect.map((hash) => ({
        parentBlockHash: hash,
        secondsSinceEpoch: number,
        secondsSinceEpochErr: 1,
      })),
    );

  static init(
    genesisMints: Readonly<
      Arr.NonEmptyArray<{ amount: bigint; type: ledger.RawTokenType; recipient: ledger.ZswapSecretKeys }>
    >,
  ): Effect.Effect<Simulator, never, Scope.Scope> {
    const emptyState = ledger.LedgerState.blank(NetworkId.NetworkId.Undeployed);
    const noStrictness = wellFormedStrictness();

    const makeTransactions = (context: ledger.BlockContext) =>
      Effect.gen(function* () {
        const nowMillis = yield* Clock.currentTimeMillis;
        const verificationTime = new Date(nowMillis);

        const tx = pipe(
          genesisMints,
          Arr.map((transfer) => {
            const coin = ledger.createShieldedCoinInfo(transfer.type, transfer.amount);
            const output = ledger.ZswapOutput.new(
              coin,
              0,
              transfer.recipient.coinPublicKey,
              transfer.recipient.encryptionPublicKey,
            );
            return ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, transfer.type, transfer.amount);
          }),
          ArrayOps.fold((acc, offer) => acc.merge(offer)),
          (offer) => ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs(),
          (tx) => tx.wellFormed(emptyState, noStrictness, verificationTime),
        );

        const [initialState, initialResult] = emptyState.apply(tx, new ledger.TransactionContext(emptyState, context));
        const postBlockUpdateState = initialState.postBlockUpdate(verificationTime);

        return {
          initialResult,
          initialState: postBlockUpdateState,
          tx,
        } as const;
      });

    return Effect.gen(function* () {
      const context = yield* Simulator.nextBlockContext(0n);
      const init = yield* makeTransactions(context);
      const initialState = {
        ledger: init.initialState,
        lastTxResult: init.initialResult,
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

  readonly #stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>;

  readonly state$: Stream.Stream<SimulatorState>;

  constructor(stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>, state$: Stream.Stream<SimulatorState>) {
    this.#stateRef = stateRef;
    this.state$ = state$;
  }

  submitTransaction(tx: ledger.ProofErasedTransaction): Effect.Effect<{ blockNumber: bigint; blockHash: string }> {
    return pipe(
      this.#stateRef,
      SubscriptionRef.modifyEffect((simulatorState) =>
        Effect.gen(function* () {
          const nextNumber = simulatorState.lastTxNumber + 1n;
          const context = yield* Simulator.nextBlockContext(nextNumber);
          const nowMillis = yield* Clock.currentTimeMillis;
          const verificationTime = new Date(nowMillis);

          const noStrictness = wellFormedStrictness();
          const verifiedTx = tx.wellFormed(simulatorState.ledger, noStrictness, verificationTime);

          const [newState, result] = simulatorState.ledger.apply(
            verifiedTx,
            new ledger.TransactionContext(simulatorState.ledger, context),
          );

          const postBlockUpdatedState = newState.postBlockUpdate(verificationTime);

          const newSimulatorState = {
            ...simulatorState,
            ledger: postBlockUpdatedState,
            lastTxResult: result,
            lastTxNumber: nextNumber,
          };

          const output = {
            blockNumber: nextNumber,
            blockHash: context.parentBlockHash,
          };

          return [output, newSimulatorState];
        }),
      ),
    );
  }
}
