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
import {
  type DustParameters,
  DustSecretKey,
  Event,
  LedgerParameters,
  type ProofErasedTransaction,
  type SignatureVerifyingKey,
  type UserAddress,
  addressFromKey,
  nativeToken,
  signData,
  signatureVerifyingKey,
} from '@midnight-ntwrk/ledger-v8';
import { InMemoryTransactionHistoryStorage, type NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Stream, SubscriptionRef } from 'effect';
import { CoreWallet } from '../CoreWallet.js';
import { makeSimulatorSyncCapability, makeSimulatorSyncService } from '../Sync.js';
import { DustTransactionHistoryEntrySchema, makeSimulatorTransactionHistoryService } from '../TransactionHistory.js';
import * as Transacting from '../Transacting.js';
import { type UtxoWithMeta } from '../types/Dust.js';
import { V1Builder } from '../V1Builder.js';

const NIGHT_TOKEN_TYPE = nativeToken().raw;
const SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const NETWORK: NetworkId.NetworkId = 'undeployed' as NetworkId.NetworkId;

/**
 * How many Night UTXOs are rewarded, and therefore how many dust events the fixture produces.
 *
 * One reward per block, then one *separate* registration transaction per Night UTXO, so every registration block
 * carries exactly one `dustInitialUtxo` event. Registering several UTXOs in a single transaction does not work for this
 * purpose: the registration splits them across the guaranteed and fallible sections and only some of them produce an
 * event, so the event count stops tracking the input count.
 */
export const DUST_EVENT_COUNT = 4;

/** The dust HD key for {@link SEED} — the same derivation the wallet itself uses. */
const dustSeed = (): Uint8Array => {
  const result = HDWallet.fromSeed(Buffer.from(SEED, 'hex'));
  const { hdWallet } = result as { type: 'seedOk'; hdWallet: HDWallet };
  const derived = hdWallet.selectAccount(0).selectRole(Roles.Dust).deriveKeyAt(0);
  if (derived.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }
  return derived.key;
};

/**
 * A minimal unshielded keystore over the dust seed.
 *
 * @remarks
 *   Local rather than imported from the package's `test/` directory: that copy speaks ledger-v9's tagged signing keys,
 *   while this tree needs ledger-v8's plain hex-string form of the same thing.
 */
const keystoreOf = (seed: Uint8Array) => {
  const signingKey = Buffer.from(seed).toString('hex');
  const publicKey = (): SignatureVerifyingKey => signatureVerifyingKey(signingKey);
  return {
    publicKey,
    address: (): UserAddress => addressFromKey(publicKey()),
    sign: (data: Uint8Array) => signData(signingKey, data),
  };
};

const nightWithMeta = (state: V8.SimulatorState, address: UserAddress): UtxoWithMeta[] =>
  [...state.ledger.utxo.filter(address)]
    .filter((utxo) => utxo.type === NIGHT_TOKEN_TYPE)
    .flatMap((utxo) => {
      const meta = state.ledger.utxo.lookupMeta(utxo);
      return meta === undefined ? [] : [{ ...utxo, ctime: meta.ctime, registeredForDustGeneration: false }];
    });

export const dustParameters = (): DustParameters => LedgerParameters.initialParameters().dust;

export const fixtureSecretKey = (): DustSecretKey => DustSecretKey.fromSeed(Buffer.from(dustSeed()));

export const freshWallet = (): CoreWallet => CoreWallet.initEmpty(dustParameters(), fixtureSecretKey(), NETWORK);

/** A real dust chain plus the events it produced. */
export type DustChain = {
  /**
   * Serialized bytes of the {@link DUST_EVENT_COUNT} real `dustInitialUtxo` events, in chain order.
   *
   * Bytes rather than `Event` instances on purpose: `replayEventsWithChanges` takes ownership of the events it is
   * handed (wasm-bindgen moves them), so re-using an instance throws. Every use deserializes its own.
   */
  readonly eventBytes: readonly Uint8Array[];
  /** The simulator state after the last registration. Its blocks still hold live, unconsumed `Event` instances. */
  readonly state: V8.SimulatorState;
  /** A time strictly after the last block, safe to value the resulting dust at. */
  readonly syncTime: Date;
};

/**
 * Drives a real dust chain: {@link DUST_EVENT_COUNT} Night rewards, then one registration transaction per Night UTXO.
 *
 * @remarks
 *   Every registration block carries exactly one `dustInitialUtxo` event, so block numbers and event ids line up one to
 *   one — which is what lets the same fixture drive both the batched indexer capability and the block-granular
 *   simulator capability.
 *
 *   Each call builds a fresh chain. The simulator's blocks hold the only live `Event` instances, and replaying them
 *   consumes them, so a state cannot be shared between two tests that both apply it.
 * @param protocolVersion The version every block of this chain is stamped with. Defaults to the simulator's own default.
 */
export const buildDustChain = (protocolVersion?: ProtocolVersion.ProtocolVersion): Promise<DustChain> =>
  Effect.gen(function* () {
    const simulator = yield* V8.Simulator.init({
      networkId: NETWORK,
      ...(protocolVersion === undefined ? {} : { protocolVersion }),
    });
    const secretKey = fixtureSecretKey();
    const keystore = keystoreOf(dustSeed());
    const verifyingKey = keystore.publicKey();

    const variant = new V1Builder()
      .withTransactionType<ProofErasedTransaction>()
      .withCoinSelectionDefaults()
      .withTransacting(Transacting.makeSimulatorTransactingCapability)
      .withSync(makeSimulatorSyncService, makeSimulatorSyncCapability)
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withSerializationDefaults()
      .withTransactionHistory(makeSimulatorTransactionHistoryService)
      .build({
        simulator,
        networkId: NETWORK,
        costParameters: { feeBlocksMargin: 5 },
        txHistoryStorage: new InMemoryTransactionHistoryStorage(DustTransactionHistoryEntrySchema),
        indexerClientConnection: { indexerHttpUrl: '' },
      });

    const initial = CoreWallet.initEmpty(dustParameters(), secretKey, NETWORK);
    const stateRef = yield* SubscriptionRef.make(initial);
    const running = yield* variant.start({
      stateRef,
      activationRange: ProtocolVersion.makeRange(
        ProtocolVersion.MinSupportedVersion,
        ProtocolVersion.MaxSupportedVersion,
      ),
    });
    yield* running.startSyncInBackground(secretKey);

    const syncedTo = (blockNumber: bigint) =>
      Stream.runLast(stateRef.changes.pipe(Stream.find((wallet) => wallet.progress.appliedIndex >= blockNumber + 1n)));

    yield* Effect.repeatN(simulator.rewardNight(verifyingKey, 150_000_000_000n), DUST_EVENT_COUNT - 1);
    yield* syncedTo(BigInt(DUST_EVENT_COUNT));

    const rewarded = yield* simulator.getLatestState();
    const nightUtxos = nightWithMeta(rewarded, keystore.address());

    yield* Effect.forEach(
      nightUtxos,
      (utxo, index) =>
        Effect.gen(function* () {
          const current = yield* simulator.getLatestState();
          const now = DateOps.addSeconds(current.currentTime, 1);
          const unsigned = yield* running.createDustGenerationTransaction(
            now,
            DateOps.addSeconds(now, 1),
            [utxo],
            verifyingKey,
            new DustAddress(initial.publicKey.publicKey),
          );
          const signature = keystore.sign(unsigned.intents!.get(1)!.signatureData(1));
          const signed = yield* running.addDustGenerationSignature(unsigned, signature);
          // The simulator takes proof-erased transactions, so erasing here is the whole of "proving" on this path —
          // the same shortcut `makeSimulatorProvingServiceEffect` takes, without depending on it.
          yield* simulator.submitTransaction(signed.eraseProofs());
          yield* syncedTo(BigInt(DUST_EVENT_COUNT + index + 1));
        }),
      { discard: true },
    );

    const state = yield* simulator.getLatestState();
    const eventBytes = [...V8.getBlockEventsFrom(state, 0n)].map((event) => event.serialize());
    return { eventBytes, state, syncTime: DateOps.addSeconds(state.currentTime, 2) };
  }).pipe(Effect.scoped, Effect.runPromise);

/** Deserializes a fresh, unconsumed instance of the fixture event at `index`. */
export const eventAt = (eventBytes: readonly Uint8Array[], index: number): Event =>
  Event.deserialize(eventBytes[index]);
