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
// Snapshots written by the last SDK release on the ledger-v8 line, replayed on this build. See
// `scripts/cross-release-corpus/README.md` for what they are and how they are regenerated; the short version is that
// every other serialization test round-trips a snapshot this code wrote a moment earlier, which cannot see a format
// that drifted between releases.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeDefaultV1SerializationCapability } from '../src/v1/Serialization.js';
import { makeCrossLedgerMigration } from '../src/v2/Migration.js';

/**
 * The corpus this file asserts against, named by the release that wrote it.
 *
 * Explicit rather than discovered: the values below — which coins, which cursor — are facts about _this_ release's
 * output, so a second corpus from a later release is a second block of cases, not the same ones pointed elsewhere.
 */
const FROM_RELEASE = 'from-1.2.0';

const corpus = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cross-release', FROM_RELEASE);
const fixture = (name: string): string => readFileSync(join(corpus, `${name}.json`), 'utf8');
const restored = (name: string) => {
  const result = makeDefaultV1SerializationCapability().deserialize(null, fixture(name));
  expect(Either.isRight(result)).toBe(true);
  if (Either.isLeft(result)) throw new Error(String(result.left));
  return result.right;
};

describe('a shielded snapshot written by the last ledger-v8 release', () => {
  it('carries the coins that release held, at their places in the tree', () => {
    // The ledger-v8 commitment tree, read by a build whose head variant is on ledger-v9. Positions as well as values,
    // because a coin at the wrong index cannot be spent even when its value is right.
    const wallet = restored('shielded-funded');
    const coins = [...wallet.state.coins];

    expect(coins.length).toBe(2);
    expect(coins.map((coin) => coin.value).sort((a, b) => Number(a - b))).toEqual([100n, 250n]);
    expect(coins.map((coin) => coin.mt_index).sort((a, b) => Number(a - b))).toEqual([0n, 1n]);
    expect(wallet.state.firstFree).toBe(2n);
  });

  it('carries a hash for every coin, so the restored wallet can tell spent from unspent', () => {
    const wallet = restored('shielded-funded');

    expect(Object.keys(wallet.coinHashes).length).toBe([...wallet.state.coins].length);
    for (const entry of Object.values(wallet.coinHashes)) {
      expect(entry.commitment).not.toBe(entry.nullifier);
    }
  });
});

describe('a shielded snapshot from that release, carried across the ledger boundary', () => {
  // The step the cases above stop short of, and the one only a foreign snapshot can exercise. The shielded carry is
  // `ZswapLocalState.deserialize(previous.state.serialize())` — so a state decoded from another release's bytes is
  // re-serialized by *this* build's ledger-v8 and handed to ledger-v9. The corpus was written against ledger-v8
  // 8.1.2 and this build resolves 8.1.0; a state that decodes but does not survive that pair would strand exactly
  // the wallets that upgraded.
  const carried = () => Effect.runPromise(makeCrossLedgerMigration().migrate(restored('shielded-funded')));

  it('arrives on ledger-v9 holding those coins, at the same places in the tree', async () => {
    const migrated = await carried();
    const coins = [...migrated.state.coins];

    // The corpus's own literals, not values read back off the source wallet: comparing the two sides would be
    // satisfied by a carry that returned its input untouched, which is the one thing a carry must not be trusted on.
    expect(coins.length).toBe(2);
    expect(coins.map((coin) => coin.value).sort((a, b) => Number(a - b))).toEqual([100n, 250n]);
    expect(coins.map((coin) => coin.mt_index).sort((a, b) => Number(a - b))).toEqual([0n, 1n]);
    expect(migrated.state.firstFree).toBe(2n);
  });

  it('keeps the identity that release recorded, so the same owner holds the crossed coins', async () => {
    const migrated = await carried();

    expect(migrated.publicKeys.coinPublicKey).toBe('7c509af3e074189300874c4562cac07e4529746387989507c0e71c47255ddf1a');
    expect(migrated.publicKeys.encryptionPublicKey).toBe(
      '8aeb07fbd7719d401ead333a59a247071c7fa8811ada3ef2f5fac3bb8356058f',
    );
    expect(migrated.networkId).toBe('undeployed');
  });
});
