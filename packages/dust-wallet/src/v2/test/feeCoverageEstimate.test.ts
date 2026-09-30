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
// When a first-time registration will be able to pay its own fee, and what the wallet says when it cannot yet.
//
// The estimate is pinned against `claimableFeePayment`, the reading `waitForGeneratedDust` waits on: the estimated
// moment is the first whole second at which that reading reaches the fee, so a caller who waits for the estimate and a
// caller who calls the wait land on the same second.
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { DustWalletState, claimableFeePayment } from '../../DustWalletAPI.js';
import { type FeeCoverageEstimate, InsufficientDustForFeeError } from '../WalletError.js';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';
import { V2Tag } from '../RunningV2Variant.js';
import { type UtxoWithMeta } from '../types/Dust.js';

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

const NOW = new Date(1_700_000_000_000);
const secondsBefore = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);
const oneSecondBefore = (time: Date): Date => new Date(time.getTime() - 1000);

const nightUtxo = (
  outputNo: number,
  { value = 1_000_000_000n, ctime = secondsBefore(3600), registeredForDustGeneration = false } = {},
): UtxoWithMeta => ({
  value,
  owner: ledger.sampleUserAddress(),
  type: NIGHT,
  intentHash: ledger.sampleIntentHash(),
  outputNo,
  ctime,
  registeredForDustGeneration,
});

const wallet = CoreWallet.initEmpty(dustParameters, dustSecretKey, NETWORK);
const state: DustWalletState = DustWalletState.fromVariant(capabilities, {
  version: ProtocolVersion.MinSupportedVersion,
  variantTag: V2Tag,
  state: wallet,
});
const feeCoverageEstimate: typeof capabilities.coinsAndBalances.feeCoverageEstimate = (...args) =>
  capabilities.coinsAndBalances.feeCoverageEstimate(...args);

const reachable = (estimate: FeeCoverageEstimate): Extract<FeeCoverageEstimate, { _tag: 'Reachable' }> => {
  if (estimate._tag !== 'Reachable') throw new Error(`expected a reachable estimate, got ${estimate.reason}`);
  return estimate;
};

describe('feeCoverageEstimate', () => {
  it('lands on the first whole second at which the claimable fee payment reaches the fee', () => {
    const utxos = [nightUtxo(0)];
    const fee = claimableFeePayment(state, utxos, NOW) + 1_000_000_000_000_000n;

    const estimate = reachable(feeCoverageEstimate(wallet, utxos, fee, NOW));

    expect(claimableFeePayment(state, utxos, estimate.at) >= fee).toBe(true);
    expect(claimableFeePayment(state, utxos, oneSecondBefore(estimate.at)) < fee).toBe(true);
    expect(estimate.at.getTime() - NOW.getTime()).toBe(Number(estimate.seconds) * 1000);
  });

  it('is immediate when the claimable fee payment already covers the fee', () => {
    const utxos = [nightUtxo(0)];
    const fee = claimableFeePayment(state, utxos, NOW);

    expect(feeCoverageEstimate(wallet, utxos, fee, NOW)).toEqual({ _tag: 'Reachable', seconds: 0n, at: NOW });
  });

  it('follows whichever UTxO reaches the fee first, not the one leading now', () => {
    // `older` leads now on age; `younger` holds ten times the Night, so generates ten times faster and overtakes it.
    const older = nightUtxo(0, { value: 1_000_000_000n, ctime: secondsBefore(3600) });
    const younger = nightUtxo(1, { value: 10_000_000_000n, ctime: secondsBefore(60) });
    const fee = 100_000_000_000_000_000n;
    const [olderNow, youngerNow] = state.estimateDustGeneration([older, younger], NOW);
    expect(olderNow.dust.generatedNow > youngerNow.dust.generatedNow).toBe(true);

    const estimate = reachable(feeCoverageEstimate(wallet, [older, younger], fee, NOW));
    const olderAlone = reachable(feeCoverageEstimate(wallet, [older], fee, NOW));

    expect(estimate.at < olderAlone.at).toBe(true);
    expect(claimableFeePayment(state, [older, younger], estimate.at) >= fee).toBe(true);
    expect(claimableFeePayment(state, [older, younger], oneSecondBefore(estimate.at)) < fee).toBe(true);
  });

  it('ignores a UTxO the indexer flags as registered, however fast it generates', () => {
    const unregistered = nightUtxo(0);
    const registered = nightUtxo(1, { value: 10_000_000_000n, registeredForDustGeneration: true });
    const fee = claimableFeePayment(state, [unregistered], NOW) + 1_000_000_000_000_000n;

    expect(feeCoverageEstimate(wallet, [unregistered, registered], fee, NOW)).toEqual(
      feeCoverageEstimate(wallet, [unregistered], fee, NOW),
    );
  });

  it('says nothing generates when no unregistered UTxO holds any Night', () => {
    const fee = 1_000n;

    expect(feeCoverageEstimate(wallet, [], fee, NOW)).toEqual({ _tag: 'Unreachable', reason: 'NoGeneration' });
    expect(feeCoverageEstimate(wallet, [nightUtxo(0, { value: 0n })], fee, NOW)).toEqual({
      _tag: 'Unreachable',
      reason: 'NoGeneration',
    });
    expect(feeCoverageEstimate(wallet, [nightUtxo(0, { registeredForDustGeneration: true })], fee, NOW)).toEqual({
      _tag: 'Unreachable',
      reason: 'NoGeneration',
    });
  });

  it('says the fee exceeds the cap when no generating UTxO can ever hold that much dust', () => {
    const utxo = nightUtxo(0);
    const [{ dust }] = state.estimateDustGeneration([utxo], NOW);

    expect(feeCoverageEstimate(wallet, [utxo, nightUtxo(1, { value: 0n })], dust.maxCap + 1n, NOW)).toEqual({
      _tag: 'Unreachable',
      reason: 'ExceedsCap',
    });
  });

  it('reaches a fee exactly at the cap', () => {
    const utxo = nightUtxo(0);
    const [{ dust }] = state.estimateDustGeneration([utxo], NOW);

    const estimate = reachable(feeCoverageEstimate(wallet, [utxo], dust.maxCap, NOW));

    expect(claimableFeePayment(state, [utxo], estimate.at)).toBe(dust.maxCap);
    expect(claimableFeePayment(state, [utxo], oneSecondBefore(estimate.at)) < dust.maxCap).toBe(true);
  });
});

describe('InsufficientDustForFeeError', () => {
  const at = new Date(NOW.getTime() + 90_000);

  it('is a tagged Error carrying the claimable fee payment, the fee and the shortfall between them', () => {
    const error = InsufficientDustForFeeError.of({
      claimableFeePayment: 10n,
      fee: 25n,
      estimate: { _tag: 'Reachable', seconds: 90n, at },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error._tag).toBe('Wallet.InsufficientDustForFee');
    expect(error.claimableFeePayment).toBe(10n);
    expect(error.fee).toBe(25n);
    expect(error.shortfall).toBe(15n);
    expect(error.estimate).toEqual({ _tag: 'Reachable', seconds: 90n, at });
  });

  it('keeps the message callers already match on, points at the wait, and states when the fee is covered', () => {
    const error = InsufficientDustForFeeError.of({
      claimableFeePayment: 10n,
      fee: 25n,
      estimate: { _tag: 'Reachable', seconds: 90n, at },
    });

    expect(error.message).toContain('Insufficient generated dust to cover registration fee (have 10, need 25).');
    expect(error.message).toContain('WalletFacade.waitForGeneratedDust(utxos, 25)');
    expect(error.message).toContain('90 s');
    expect(error.message).toContain(at.toISOString());
  });

  it.each(['NoGeneration', 'ExceedsCap'] as const)('says plainly when the fee will never be covered (%s)', (reason) => {
    const error = InsufficientDustForFeeError.of({
      claimableFeePayment: 0n,
      fee: 25n,
      estimate: { _tag: 'Unreachable', reason },
    });

    expect(error.message).toContain('Insufficient generated dust to cover registration fee (have 0, need 25).');
    expect(error.message).toContain('never');
  });
});
