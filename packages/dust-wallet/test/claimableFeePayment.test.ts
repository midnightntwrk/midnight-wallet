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
//
// What `waitForGeneratedDust` waits for.
//
// The wait exists so a first-time registration can pay its own fee: the ledger lets a registration spend the
// retroactive dust its still-generationless Night has accrued (`generationless_fee_availability`), and the wait is
// how a caller finds out when that has reached the fee. Everything about the wait — how long it takes, whether it
// ever resolves — is decided by one pure reading over the Night UTxOs handed to it, which is what these tests pin.
//
// The reading is the indexer's `registeredForDustGeneration` flag and nothing else. The indexer scopes that flag to
// the current dust epoch, so it is the one authority on whether a UTxO still generates; the wallet's own dust
// holdings do not enter into it, and a UTxO the flag calls registered is never waited on however little dust the
// wallet has.
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { DustWalletState, claimableFeePayment } from '../src/DustWallet.js';
import { makeDefaultCoinsAndBalancesCapability } from '../src/v2/CoinsAndBalances.js';
import { CoreWallet } from '../src/v2/CoreWallet.js';
import { makeDefaultKeysCapability } from '../src/v2/Keys.js';
import { makeDefaultV2SerializationCapability } from '../src/v2/Serialization.js';
import { V2Tag } from '../src/v2/RunningV2Variant.js';
import { type Dust, type UtxoWithMeta } from '../src/v2/types/Dust.js';

const NIGHT = ledger.nativeToken().raw;
const NETWORK = NetworkId.NetworkId.Undeployed;

const dustSecretKey = ledger.DustSecretKey.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256));
const dustParameters = ledger.LedgerParameters.initialParameters().dust;

const keys = makeDefaultKeysCapability();
const capabilities = {
  serialization: makeDefaultV2SerializationCapability(),
  coinsAndBalances: makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability: keys })),
  keys,
};

/** A Night UTxO created an hour before `NOW`, so it has had time to accrue dust. */
const CREATED_AT = new Date(1_700_000_000_000);
const NOW = new Date(CREATED_AT.getTime() + 60 * 60 * 1000);

const nightUtxo = (outputNo: number, registeredForDustGeneration: boolean, value = 1_000_000_000n): UtxoWithMeta => ({
  value,
  owner: ledger.sampleUserAddress(),
  type: NIGHT,
  intentHash: ledger.sampleIntentHash(),
  outputNo,
  ctime: CREATED_AT,
  registeredForDustGeneration,
});

/** The dust coin the ledger mints when `utxo` is registered: one whose `backingNight` is that UTxO's initial nonce. */
const dustCoinBacking = (utxo: UtxoWithMeta, nonce: bigint): Dust => ({
  initialValue: 1_000n,
  owner: dustSecretKey.publicKey,
  nonce,
  seq: 0,
  ctime: CREATED_AT,
  backingNight: ledger.dustInitialNonce(BigInt(utxo.outputNo), utxo.intentHash),
  mtIndex: 0n,
});

const stateHolding = (coins: readonly Dust[]): DustWalletState => {
  const base = CoreWallet.initEmpty(dustParameters, dustSecretKey, NETWORK);
  const wallet: CoreWallet = {
    ...base,
    state: coins.reduce((state, coin) => state.addUtxo(ledger.dustNullifier(coin, dustSecretKey), coin), base.state),
  };
  return DustWalletState.fromVariant(capabilities, {
    version: ProtocolVersion.MinSupportedVersion,
    variantTag: V2Tag,
    state: wallet,
  });
};

describe('claimableFeePayment', () => {
  it('counts a Night UTxO the indexer flags as unregistered', () => {
    const utxo = nightUtxo(0, false);

    expect(claimableFeePayment(stateHolding([]), [utxo], NOW) > 0n).toBe(true);
  });

  it('is exactly the dust that UTxO is estimated to have generated', () => {
    const utxo = nightUtxo(0, false);
    const state = stateHolding([]);
    const [estimated] = state.estimateDustGeneration([utxo], NOW);

    expect(claimableFeePayment(state, [utxo], NOW)).toBe(estimated.dust.generatedNow);
  });

  it('ignores a Night UTxO the indexer flags as registered, whatever dust the wallet holds', () => {
    // Both readings of "whatever dust the wallet holds": a wallet with the dust coin that Night mints, and a wallet
    // with none at all. The flag alone decides, so both claim nothing — including the empty wallet, whose holdings
    // say the UTxO generates nothing while the indexer says it does.
    const utxo = nightUtxo(0, true);

    expect(claimableFeePayment(stateHolding([dustCoinBacking(utxo, 1n)]), [utxo], NOW)).toBe(0n);
    expect(claimableFeePayment(stateHolding([]), [utxo], NOW)).toBe(0n);
  });

  it('takes the largest single flag-false UTxO, since only one lands in the guaranteed slot', () => {
    const small = nightUtxo(0, false, 1_000_000_000n);
    const large = nightUtxo(1, false, 3_000_000_000n);
    const state = stateHolding([]);
    const [smallEstimate, largeEstimate] = state.estimateDustGeneration([small, large], NOW);

    // Not the sum: the guaranteed slot holds one UTxO, so only one UTxO's retroactive dust is ever claimable.
    expect(smallEstimate.dust.generatedNow > 0n).toBe(true);
    expect(claimableFeePayment(state, [small, large], NOW)).toBe(largeEstimate.dust.generatedNow);
  });

  it('a flag-true UTxO does not raise the ceiling a flag-false one sets', () => {
    const registered = nightUtxo(0, true, 3_000_000_000n);
    const unregistered = nightUtxo(1, false, 1_000_000_000n);
    const state = stateHolding([]);
    const [, unregisteredEstimate] = state.estimateDustGeneration([registered, unregistered], NOW);

    expect(claimableFeePayment(state, [registered, unregistered], NOW)).toBe(unregisteredEstimate.dust.generatedNow);
  });
});
