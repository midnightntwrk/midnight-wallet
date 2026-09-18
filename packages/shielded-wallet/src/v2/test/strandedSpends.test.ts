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
 * What becomes of coins a wallet reserved for a ledger-v8 transaction that the chain then forked away from.
 *
 * @remarks
 *   A wallet crosses the ledger-version boundary as bytes, and `pendingSpends` — the coins it had booked for transactions
 *   still in flight — crosses with everything else. Those transactions belong to a ledger version the chain has left:
 *   none of them can ever be included, so nothing on the far side will ever clear the reservation, and a coin whose
 *   reservation is never cleared is one `getAvailableCoins` never offers again. The remedy under test is the first sync
 *   update, the first place the carried state and the secret keys meet: it releases every reservation the wallet
 *   arrived holding, once, and leaves a wallet that never crossed alone.
 *
 *   Both ledgers are the real modules, and the reservation under test is a real one — a ledger-v8 spend built against a
 *   ledger-v8 tree, carried over by the migration itself. Nothing here is stubbed: whether a ledger-v9 state will
 *   re-derive and drop a reservation minted by ledger-v8 is a question only the two modules can answer, and whether the
 *   coin is still spendable afterwards is one only a chain can.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, type SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Either, pipe } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { type PreviousLedgerWallet, makeCrossLedgerMigration } from '../Migration.js';
import { WalletSyncUpdate, makeEventsSyncCapability } from '../Sync.js';

// Real cryptography in two WASM ledgers at once, which on a loaded runner outlasts the 30s default.
vi.setConfig({ testTimeout: 120_000 });

const networkId = NetworkId.NetworkId.Undeployed;
const seed = Buffer.alloc(32, 3);
const v8Keys = (): ledgerV8.ZswapSecretKeys => ledgerV8.ZswapSecretKeys.fromSeed(seed);
const keys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(seed);

const tokenType = ledgerV8.shieldedToken().raw;
const value = 500n;

/** The version that triggered the hand-over, and the range the V2 variant owns from it. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);
const activeRange = ProtocolVersion.makeRange(forkVersion, ProtocolVersion.MaxSupportedVersion);

const parkedProgress: SyncProgress.SyncProgressData = {
  appliedIndex: 4321n,
  highestRelevantWalletIndex: 4400n,
  highestIndex: 4400n,
  highestRelevantIndex: 4400n,
  isConnected: true,
};

const capability = makeEventsSyncCapability();
const coinsAndBalances = makeDefaultCoinsAndBalancesCapability();

/** An empty batch, which is the case that matters: a quiet timeline must not skip the release. */
const emptyUpdate = (): WalletSyncUpdate => WalletSyncUpdate.create([], keys());

/** One payment of `value` to this wallet, on the ledger the chain ran below `forks.v9`. */
const v8Payment = (): Readonly<{
  coin: ledgerV8.ShieldedCoinInfo;
  offer: ledgerV8.ZswapOffer<ledgerV8.PreProof>;
}> => {
  const mine = v8Keys();
  const coin = ledgerV8.createShieldedCoinInfo(tokenType, value);
  const output = ledgerV8.ZswapOutput.new(coin, 0, mine.coinPublicKey, mine.encryptionPublicKey);
  return { coin, offer: ledgerV8.ZswapOffer.fromOutput<ledgerV8.PreProof>(output, coin.type, coin.value) };
};

const payment = v8Payment();

/**
 * A ledger-v8 wallet holding one coin it has already booked for a transaction in flight.
 *
 * @remarks
 *   Exactly the shape a wallet is in when a hard fork catches it mid-submission: the coin is still in the tree, and a
 *   nullifier for it sits in `pendingSpends` waiting for an inclusion that the boundary makes impossible.
 */
const v8StateWithReservedSpend = (): ledgerV8.ZswapLocalState => {
  const mine = v8Keys();
  const settled = new ledgerV8.ZswapLocalState().apply(mine, payment.offer);
  const [reserved] = settled.spend(mine, [...settled.coins][0], 0);
  return reserved;
};

/** A wallet of the previous ledger version, as the runtime hands one over. */
const previousWallet = (state: ledgerV8.ZswapLocalState): PreviousLedgerWallet => {
  const mine = v8Keys();
  return {
    publicKeys: { coinPublicKey: mine.coinPublicKey, encryptionPublicKey: mine.encryptionPublicKey },
    networkId,
    protocolVersion: forkVersion,
    progress: parkedProgress,
    state,
  };
};

const crossed = (): Promise<CoreWallet> =>
  Effect.runPromise(makeCrossLedgerMigration().migrate(previousWallet(v8StateWithReservedSpend())));

/**
 * The ledger-v9 chain the fork left behind, holding the ledger-v8 commitment.
 *
 * @remarks
 *   The translation stub's construction: re-paying the same coin to the same public keys reproduces the ledger-v8
 *   commitment, because a commitment is a function of the coin and its owner alone. It is what gives "the coin still
 *   spends" its teeth — a spend carries a Merkle path, and a chain accepts it only if that path resolves to a root the
 *   chain holds.
 */
const v9Chain = (): ledger.ZswapChainState => {
  const mine = keys();
  const coin = { type: payment.coin.type, nonce: payment.coin.nonce, value: payment.coin.value };
  const output = ledger.ZswapOutput.new(coin, 0, mine.coinPublicKey, mine.encryptionPublicKey);
  const [applied] = new ledger.ZswapChainState().tryApply(
    ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, coin.type, coin.value),
  );
  return applied.postBlockUpdate(new Date(1_000), 3_600n);
};

/** Builds a spend of `coin` off `state` and offers it to `chain`, keeping whatever the ledger said if it refuses. */
const spendAgainst = (
  chain: ledger.ZswapChainState,
  state: ledger.ZswapLocalState,
  coin: ledger.QualifiedShieldedCoinInfo,
): Either.Either<ledger.ZswapChainState, string> =>
  Either.try({
    try: () => {
      const [, input] = state.spend(keys(), coin, 0);
      const [applied] = chain.tryApply(ledger.ZswapOffer.fromInput(input, coin.type, coin.value));
      return applied;
    },
    catch: (error) => (error instanceof Error ? error.message : String(error)),
  });

describe('a spend a wallet reserved coins for below `forks.v9`', () => {
  it('crosses the boundary as a reservation nothing on the far side can ever clear', async () => {
    // The premise, read off the migration rather than assumed: the bytes carry `pendingSpends` too, and while the
    // reservation stands the coin is not in the available set, nor in the balance the wallet reports.
    const wallet = await crossed();
    const resolved = CoreWallet.resolveCoinHashes(wallet, keys());

    expect(wallet.state.pendingSpends.size).toBe(1);
    expect([...wallet.state.coins].length).toBe(1);
    expect(coinsAndBalances.getAvailableCoins(resolved)).toEqual([]);
    expect(coinsAndBalances.getAvailableBalances(resolved)).toEqual({});
  });

  it('is released by the first sync update, even an empty one, and the coin comes back whole', async () => {
    const wallet = await crossed();
    const rootBeforeRelease = wallet.state.merkleTreeRoot;
    const firstFreeBeforeRelease = wallet.state.firstFree;

    const [state] = capability.applyUpdate(wallet, emptyUpdate(), activeRange);

    expect(state.state.pendingSpends.size).toBe(0);

    const available = coinsAndBalances.getAvailableCoins(state);
    expect(available.map(({ coin }) => coin.nonce)).toEqual([payment.coin.nonce]);
    expect(coinsAndBalances.getAvailableBalances(state)).toEqual({ [tokenType]: value });

    // The release must not disturb the tree the coin hangs off: same root, same height, same Merkle index.
    expect(state.state.merkleTreeRoot).toBe(rootBeforeRelease);
    expect(state.state.firstFree).toBe(firstFreeBeforeRelease);
    expect(available[0].coin.mt_index).toBe([...wallet.state.coins][0].mt_index);

    // And the coin is money again, by the only measure that counts: the chain the fork left behind takes the spend.
    expect(spendAgainst(v9Chain(), state.state, available[0].coin)).toStrictEqual(Either.right(expect.anything()));
  });
});

describe('a spend of a wallet that never crossed', () => {
  /** A wallet of this ledger version, holding one coin, built the way a syncing wallet builds one. */
  const settledWallet = (): CoreWallet => {
    const mine = keys();
    const coin = ledger.createShieldedCoinInfo(ledger.shieldedToken().raw, value);
    const output = ledger.ZswapOutput.new(coin, 0, mine.coinPublicKey, mine.encryptionPublicKey);
    const offer = ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, coin.type, coin.value);
    return CoreWallet.init(new ledger.ZswapLocalState().apply(mine, offer), mine, networkId);
  };

  const withReservedSpend = (wallet: CoreWallet): CoreWallet =>
    pipe(CoreWallet.spendCoins(wallet, keys(), [[...wallet.state.coins][0]], 0), ([, reserved]) => reserved);

  it('stands through the same update, because that transaction can still be included', () => {
    const wallet = withReservedSpend(settledWallet());
    expect(wallet.coinHashesPending).toBeUndefined();

    const [state] = capability.applyUpdate(wallet, emptyUpdate(), activeRange);

    expect(state.state.pendingSpends.size).toBe(1);
    expect(coinsAndBalances.getAvailableCoins(state)).toEqual([]);
  });

  it('stands through the same update once the wallet has crossed and been released, because the marker is spent', async () => {
    // The release is a one-off tied to the crossing, not a standing policy: a reservation this wallet makes on the far
    // side is a live transaction of this ledger version, and dropping it would let the wallet double-spend its own coin.
    const [released] = capability.applyUpdate(await crossed(), emptyUpdate(), activeRange);
    expect(released.state.pendingSpends.size).toBe(0);

    const reserved = withReservedSpend(released);
    expect(reserved.state.pendingSpends.size).toBe(1);

    const [state] = capability.applyUpdate(reserved, emptyUpdate(), activeRange);

    expect(state.state.pendingSpends.size).toBe(1);
    expect(coinsAndBalances.getAvailableCoins(state)).toEqual([]);
  });
});
