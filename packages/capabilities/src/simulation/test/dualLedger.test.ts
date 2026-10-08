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
 * Hard-fork support requires the ledger-v8 and ledger-v9 WASM modules to be loaded and used side by side in a single
 * process. This test pins that assumption: each ledger must construct, serialize, and deserialize its own objects
 * correctly while the other is loaded and in active use.
 *
 * Deliberately NOT asserted here: any cross-version compatibility (v9 reading v8 bytes, equal commitments/token types
 * across versions). Those are separate, open questions.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';

const networkId = NetworkId.NetworkId.Undeployed;

const seed = (fill: number): Buffer => Buffer.alloc(32, fill);

describe('dual-ledger WASM coexistence', () => {
  it('constructs a blank LedgerState from each ledger in the same process', () => {
    const v8State = ledgerV8.LedgerState.blank(networkId);
    const v9State = ledgerV9.LedgerState.blank(networkId);

    expect(v8State).toBeInstanceOf(ledgerV8.LedgerState);
    expect(v9State).toBeInstanceOf(ledgerV9.LedgerState);
    // The two modules must be genuinely distinct — no shared class identity.
    expect(v8State).not.toBeInstanceOf(ledgerV9.LedgerState);
    expect(v9State).not.toBeInstanceOf(ledgerV8.LedgerState);
  });

  it('round-trips v8 LedgerState serialization with the other ledger loaded', () => {
    const original = ledgerV8.LedgerState.blank(networkId);
    const bytes = original.serialize();
    const restored = ledgerV8.LedgerState.deserialize(bytes);

    expect(restored).toBeInstanceOf(ledgerV8.LedgerState);
    expect(restored.serialize()).toEqual(bytes);
  });

  it('round-trips v9 LedgerState serialization with the other ledger loaded', () => {
    const original = ledgerV9.LedgerState.blank(networkId);
    const bytes = original.serialize();
    const restored = ledgerV9.LedgerState.deserialize(bytes);

    expect(restored).toBeInstanceOf(ledgerV9.LedgerState);
    expect(restored.serialize()).toEqual(bytes);
  });

  it('interleaves key derivation, coin creation, and hashing across both ledgers without clashes', () => {
    // Alternate between the two modules on every step so any shared global WASM state would surface.
    const v8Keys = ledgerV8.ZswapSecretKeys.fromSeed(seed(1));
    const v9Keys = ledgerV9.ZswapSecretKeys.fromSeed(seed(1));

    const v8Coin = ledgerV8.createShieldedCoinInfo(ledgerV8.shieldedToken().raw, 100n);
    const v9Coin = ledgerV9.createShieldedCoinInfo(ledgerV9.shieldedToken().raw, 100n);

    const v8Commitment = ledgerV8.coinCommitment(v8Coin, v8Keys.coinPublicKey);
    const v9Commitment = ledgerV9.coinCommitment(v9Coin, v9Keys.coinPublicKey);

    expect(v8Commitment).toMatch(/^[0-9a-f]+$/);
    expect(v9Commitment).toMatch(/^[0-9a-f]+$/);

    // Each module keeps working after the other was exercised.
    const v8Again = ledgerV8.coinCommitment(v8Coin, v8Keys.coinPublicKey);
    const v9Again = ledgerV9.coinCommitment(v9Coin, v9Keys.coinPublicKey);
    expect(v8Again).toEqual(v8Commitment);
    expect(v9Again).toEqual(v9Commitment);
  });

  it('keeps ledger state usable after heavy interleaved use of the other module', () => {
    const v8State = ledgerV8.LedgerState.blank(networkId);
    const v9State = ledgerV9.LedgerState.blank(networkId);

    // Exercise v9 between v8 operations and vice versa.
    const v8BytesFirst = v8State.serialize();
    const v9BytesFirst = v9State.serialize();
    const v9Keys = ledgerV9.ZswapSecretKeys.fromSeed(seed(7));
    const v8Keys = ledgerV8.ZswapSecretKeys.fromSeed(seed(7));
    expect(v9Keys.coinPublicKey).toBeDefined();
    expect(v8Keys.coinPublicKey).toBeDefined();

    expect(v8State.serialize()).toEqual(v8BytesFirst);
    expect(v9State.serialize()).toEqual(v9BytesFirst);
  });
});
