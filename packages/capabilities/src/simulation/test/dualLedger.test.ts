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
 * Dual-ledger coexistence spike.
 *
 * Hard-fork support requires ledger-v8 (pre-fork) and ledger-v9 (post-fork) WASM modules to be loaded and used side by
 * side in a single process. This test pins that assumption: each ledger must construct, serialize, and deserialize its
 * own objects correctly while the other is loaded and in active use.
 *
 * Deliberately NOT asserted here: any cross-version compatibility (v9 reading v8 bytes, equal commitments/token types
 * across versions). Those are separate, open questions.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';

const networkId = NetworkId.NetworkId.Undeployed;

const seed = (fill: number): Buffer => Buffer.alloc(32, fill);

describe('dual-ledger WASM coexistence', () => {
  it('constructs a blank LedgerState from each ledger in the same process', () => {
    const v8State = v8.LedgerState.blank(networkId);
    const v9State = v9.LedgerState.blank(networkId);

    expect(v8State).toBeInstanceOf(v8.LedgerState);
    expect(v9State).toBeInstanceOf(v9.LedgerState);
    // The two modules must be genuinely distinct — no shared class identity.
    expect(v8State).not.toBeInstanceOf(v9.LedgerState);
    expect(v9State).not.toBeInstanceOf(v8.LedgerState);
  });

  it('round-trips v8 LedgerState serialization with the other ledger loaded', () => {
    const original = v8.LedgerState.blank(networkId);
    const bytes = original.serialize();
    const restored = v8.LedgerState.deserialize(bytes);

    expect(restored).toBeInstanceOf(v8.LedgerState);
    expect(restored.serialize()).toEqual(bytes);
  });

  it('round-trips v9 LedgerState serialization with the other ledger loaded', () => {
    const original = v9.LedgerState.blank(networkId);
    const bytes = original.serialize();
    const restored = v9.LedgerState.deserialize(bytes);

    expect(restored).toBeInstanceOf(v9.LedgerState);
    expect(restored.serialize()).toEqual(bytes);
  });

  it('interleaves key derivation, coin creation, and hashing across both ledgers without clashes', () => {
    // Alternate between the two modules on every step so any shared global WASM state would surface.
    const v8Keys = v8.ZswapSecretKeys.fromSeed(seed(1));
    const v9Keys = v9.ZswapSecretKeys.fromSeed(seed(1));

    const v8Coin = v8.createShieldedCoinInfo(v8.shieldedToken().raw, 100n);
    const v9Coin = v9.createShieldedCoinInfo(v9.shieldedToken().raw, 100n);

    const v8Commitment = v8.coinCommitment(v8Coin, v8Keys.coinPublicKey);
    const v9Commitment = v9.coinCommitment(v9Coin, v9Keys.coinPublicKey);

    expect(v8Commitment).toMatch(/^[0-9a-f]+$/);
    expect(v9Commitment).toMatch(/^[0-9a-f]+$/);

    // Each module keeps working after the other was exercised.
    const v8Again = v8.coinCommitment(v8Coin, v8Keys.coinPublicKey);
    const v9Again = v9.coinCommitment(v9Coin, v9Keys.coinPublicKey);
    expect(v8Again).toEqual(v8Commitment);
    expect(v9Again).toEqual(v9Commitment);
  });

  it('keeps ledger state usable after heavy interleaved use of the other module', () => {
    const v8State = v8.LedgerState.blank(networkId);
    const v9State = v9.LedgerState.blank(networkId);

    // Exercise v9 between v8 operations and vice versa.
    const v8BytesFirst = v8State.serialize();
    const v9BytesFirst = v9State.serialize();
    const v9Keys = v9.ZswapSecretKeys.fromSeed(seed(7));
    const v8Keys = v8.ZswapSecretKeys.fromSeed(seed(7));
    expect(v9Keys.coinPublicKey).toBeDefined();
    expect(v8Keys.coinPublicKey).toBeDefined();

    expect(v8State.serialize()).toEqual(v8BytesFirst);
    expect(v9State.serialize()).toEqual(v9BytesFirst);
  });
});
