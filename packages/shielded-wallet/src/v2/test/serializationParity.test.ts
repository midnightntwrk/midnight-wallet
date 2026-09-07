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
// Whether a settled wallet's coin hashes survive a restart, asserted by value.
//
// Two existing shapes come close and neither closes it. The round-trip property compares one snapshot with the
// snapshot of its own restore — bytes against bytes, so a change applied to the writer and the reader together passes
// — and its generator has a maximum transaction count but no minimum, so the wallet it runs against may hold nothing
// at all. The mid-crossing cases do use a wallet holding a coin, but assert the hash map is **empty**, because that is
// the point of that window.
//
// Neither therefore says what happens to real hashes over real coins. They matter because a hash map is how the wallet
// knows which coins are already spent: a restore that dropped one would present a spent coin as available, and one
// that returned the wrong commitment would build a transaction the chain refuses.
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { pipe } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';

const keys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 5));

const coin = (nonceByte: string, value: bigint): ledger.ShieldedCoinInfo => ({
  type: ledger.shieldedToken().raw,
  nonce: nonceByte.repeat(32),
  value,
});

/** Two coins, so a restore that carried only the first is distinguishable from one that carried both. */
const coins = (): readonly ledger.ShieldedCoinInfo[] => [coin('bb', 100n), coin('cc', 250n)];

const capability = makeDefaultV2SerializationCapability();

let settled: CoreWallet;
let restored: CoreWallet;

beforeAll(() => {
  const secretKeys = keys();
  const state = coins().reduce(
    (acc: ledger.ZswapLocalState, c) => acc.insertCoin(secretKeys, c),
    new ledger.ZswapLocalState(),
  );
  // `init` is the settled path: it derives the hashes from the secret keys, which is what a wallet that has synced
  // normally holds — as opposed to `fromPreviousVersion`, which leaves them to be computed later.
  settled = CoreWallet.init(state, secretKeys, NetworkId.NetworkId.Undeployed);
  restored = pipe(capability.deserialize(null, capability.serialize(settled)), EitherOps.getOrThrowLeft);
});

describe('the coin hashes of a settled wallet that holds coins', () => {
  it('are there to begin with, so nothing below can pass over an empty map', () => {
    // The guard the property test cannot make: its generator has no minimum, so it may assert nothing at all.
    expect(Object.keys(settled.coinHashes).length).toBe(coins().length);
    expect(settled.coinHashesPending).toBeUndefined();
  });

  it('come back with the same commitment and nullifier for every coin', () => {
    // Compared entry by entry rather than by re-serializing: a snapshot that wrote the hashes under the wrong keys, or
    // swapped a commitment for a nullifier, would re-serialize to something identical to itself and pass a byte
    // comparison.
    expect(Object.keys(restored.coinHashes).sort()).toEqual(Object.keys(settled.coinHashes).sort());

    for (const key of Object.keys(settled.coinHashes)) {
      expect(restored.coinHashes[key]?.commitment).toBe(settled.coinHashes[key]?.commitment);
      expect(restored.coinHashes[key]?.nullifier).toBe(settled.coinHashes[key]?.nullifier);
    }
  });

  it('still cover every coin the restored state holds', () => {
    // The invariant the hash map exists to satisfy, restated on the far side of a restart: a coin with no hash over it
    // is a coin the wallet cannot tell the spent state of, and the deserializer refuses exactly that combination
    // unless the wallet declares itself mid-crossing.
    const restoredCoins = [...restored.state.coins];

    expect(restoredCoins.length).toBe(coins().length);
    expect(Object.keys(restored.coinHashes).length).toBe(restoredCoins.length);
    expect(restored.coinHashesPending).toBeUndefined();
  });

  it('carry values that are real hashes, not the coin fields copied through', () => {
    // Guards the fixture itself: if `init` ever returned something derived from the nonce alone, every assertion above
    // would still hold while the map had stopped meaning anything.
    const nonces = coins().map((c) => c.nonce);

    for (const entry of Object.values(restored.coinHashes)) {
      expect(nonces).not.toContain(entry.commitment);
      expect(nonces).not.toContain(entry.nullifier);
      expect(entry.commitment).not.toBe(entry.nullifier);
    }
  });
});
