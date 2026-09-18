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
 * A fork whose handover is the real ledger-side v8-to-v9 state translation.
 *
 * `forkSimulator.test.ts` specifies the seam with test-supplied translations, which is what pins its shape. This file
 * is the other half: the actual WASM translation in that slot, so the ledger-v9 chain starts from the ledger-v8 chain's
 * own state rather than from an approximation of it.
 *
 * **Integration tier because of a build step, not infra.** The translation is Rust — the ledger's translation crate
 * behind WASM bindings in `packages/state-translation/wasm` — so it has to be compiled first. `turbo` does that
 * automatically: `test:integration` depends on that package's `artifacts` gate, which builds the WASM and verifies it
 * translates, so the artifact is always present here and there is nothing to skip on. Nothing in this file needs Docker
 * or a network.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { translateLedgerState } from '@midnightntwrk/wallet-sdk-state-translation';
import { Effect, type Array as Arr } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ForkSimulator,
  V8,
  genesisStrictness,
  getCurrentBlockNumber,
  getLastBlock,
  immediateBlockProducer,
  translatorFromAsync,
} from '../index.js';

const networkId = NetworkId.NetworkId.Undeployed;

const v8Version = ProtocolVersion.ProtocolVersion(3n);
const forkVersion = ProtocolVersion.ProtocolVersion(4242n);
const forkBlock = 3n;

const v8Keys = ledgerV8.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1));
const v9Keys = ledgerV9.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1));
const v8TokenType = ledgerV8.shieldedToken().raw;
const v9TokenType = ledgerV9.shieldedToken().raw;

/** A shielded transfer on each chain: one new coin output, built straight from ledger primitives. */
const v8Transfer = (): ledgerV8.ProofErasedTransaction => {
  const coin = ledgerV8.createShieldedCoinInfo(v8TokenType, 100n);
  const output = ledgerV8.ZswapOutput.new(coin, 0, v8Keys.coinPublicKey, v8Keys.encryptionPublicKey);
  const offer = ledgerV8.ZswapOffer.fromOutput<ledgerV8.PreProof>(output, v8TokenType, 100n);
  return ledgerV8.Transaction.fromParts(networkId, offer).eraseProofs();
};

const v9Transfer = (): ledgerV9.ProofErasedTransaction => {
  const coin = ledgerV9.createShieldedCoinInfo(v9TokenType, 100n);
  const output = ledgerV9.ZswapOutput.new(coin, 0, v9Keys.coinPublicKey, v9Keys.encryptionPublicKey);
  const offer = ledgerV9.ZswapOffer.fromOutput<ledgerV9.PreProof>(output, v9TokenType, 100n);
  return ledgerV9.Transaction.fromParts(networkId, offer).eraseProofs();
};

/** The whole of the wiring: the WASM translation adapted into the seam's `Effect` shape. */
const translator = translatorFromAsync(translateLedgerState);

const baseConfig = {
  networkId,
  forkBlock,
  forkVersion,
  v8Version,
  v8BlockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
  v9BlockProducer: immediateBlockProducer(undefined, genesisStrictness),
  translator,
};

/** Ledger-v8 genesis funding, so ledger-v8 holds something worth carrying across. */
const v8GenesisMints: Arr.NonEmptyArray<V8.GenesisMint> = [
  { type: 'shielded', tokenType: v8TokenType, amount: 1_000_000n, recipient: v8Keys },
];

/**
 * Size of a ledger's coin commitment tree, read straight out of serialized state.
 *
 * Both ledgers expose this the same way, over their own bytes, which makes it the one measure that can be compared
 * across the boundary without either side's state objects being in the other's WASM module.
 */
const v8CommitmentCount = (ledger: Uint8Array): bigint =>
  ledgerV8.ZswapChainState.deserializeFromLedgerState(ledger).firstFree;
const v9CommitmentCount = (ledger: Uint8Array): bigint =>
  ledgerV9.ZswapChainState.deserializeFromLedgerState(ledger).firstFree;

describe('ForkSimulator over the real v8-to-v9 state translation', () => {
  it('accepts a translated ledger-v8 as ledger-v9 state', async () =>
    Effect.gen(function* () {
      // The load-bearing check: whether the bytes a ledger-v8 `LedgerState.serialize()` produces survive the
      // translation as bytes ledger-v9 will deserialize. Both sides use the same tagged framing, so they should — and
      // if they ever do not, this fails first and unambiguously, before anything downstream depends on it.
      const fork = yield* ForkSimulator.init(baseConfig);

      const v9Chain = yield* fork.advanceToFork();
      const state = yield* v9Chain.getLatestState();

      expect(state.ledger).toBeInstanceOf(ledgerV9.LedgerState);
      // The boundary invariants hold on the translated state, not just its parseability.
      expect(getCurrentBlockNumber(state)).toBe(forkBlock);
      expect(getLastBlock(state).protocolVersion).toBe(forkVersion);
      expect(state.protocolVersion).toBe(forkVersion);
    }).pipe(Effect.scoped, Effect.runPromise));

  it("carries the ledger-v8 chain's own coin commitments across the fork", async () =>
    Effect.gen(function* () {
      // A blank state would translate identically under a no-op, so the state has to hold something. Minted value plus
      // a transfer means the commitment tree is non-empty and has grown through real block application.
      const fork = yield* ForkSimulator.init({ ...baseConfig, v8GenesisMints: v8GenesisMints });
      yield* fork.v8.submitTransaction(v8Transfer());

      const v9Chain = yield* fork.advanceToFork();
      const preState = yield* fork.v8.getLatestState();
      const postState = yield* v9Chain.getLatestState();

      const carried = v8CommitmentCount(preState.ledger.serialize());
      expect(carried).toBeGreaterThan(0n);
      // Every commitment the ledger-v8 chain accumulated is present ledger-v9: the state crossed, it was not rebuilt.
      expect(v9CommitmentCount(postState.ledger.serialize())).toBe(carried);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('applies a ledger-v9 transaction on top of the translated state', async () =>
    Effect.gen(function* () {
      // Deserializing proves the bytes parse; this proves the state is *usable*. A translation could yield something
      // structurally valid that ledger-v9 then refuses to build on, and nothing above would catch it.
      const fork = yield* ForkSimulator.init({ ...baseConfig, v8GenesisMints: v8GenesisMints });
      yield* fork.v8.submitTransaction(v8Transfer());

      const v9Chain = yield* fork.advanceToFork();
      const carried = v9CommitmentCount((yield* v9Chain.getLatestState()).ledger.serialize());
      // Without this, a translation that carried nothing would still satisfy the count below as 0 + 1, and "on top of
      // the translated state" would not actually be what was tested.
      expect(carried).toBeGreaterThan(0n);

      const block = yield* v9Chain.submitTransaction(v9Transfer());
      const after = yield* v9Chain.getLatestState();

      // The transaction was included in a block past the boundary...
      expect(block.number).toBeGreaterThan(forkBlock);
      // ...and its commitment was appended to the tree the translation produced, rather than to a fresh one. The exact
      // count is what makes this load-bearing: `carried + 1` can only hold if the ledger-v9 chain grew the carried tree.
      expect(v9CommitmentCount(after.ledger.serialize())).toBe(carried + 1n);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('translates a state the ledger-v8 chain never touched', async () =>
    Effect.gen(function* () {
      // No mints, no transactions: the smallest state there is. It has to translate too, and to translate to something
      // recognisably empty rather than to whatever ledger-v9's own blank state happens to be.
      const fork = yield* ForkSimulator.init(baseConfig);

      const v9Chain = yield* fork.advanceToFork();
      const postState = yield* v9Chain.getLatestState();

      expect(v9CommitmentCount(postState.ledger.serialize())).toBe(0n);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('translates the same state to the same bytes', async () =>
    Effect.gen(function* () {
      // The translation is a pure function of its input, so the same ledger-v8 bytes must translate identically —
      // otherwise nothing downstream of it can be asserted on.
      //
      // The same bytes, deliberately, rather than two independently-driven chains: genesis mints carry random coin
      // nonces, so two ledger-v8 chains built from an identical config do *not* produce identical ledgers. That is the
      // harness being nondeterministic, which says nothing either way about the translation.
      const fork = yield* ForkSimulator.init({ ...baseConfig, v8GenesisMints: v8GenesisMints });
      yield* fork.advanceToFork();
      const v8State = (yield* fork.v8.getLatestState()).ledger.serialize();

      const first = yield* Effect.promise(() => translateLedgerState(v8State));
      const second = yield* Effect.promise(() => translateLedgerState(v8State));

      expect(first.length).toBeGreaterThan(0);
      expect(first).toEqual(second);
    }).pipe(Effect.scoped, Effect.runPromise));
});
