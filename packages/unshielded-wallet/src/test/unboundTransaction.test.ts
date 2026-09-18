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
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import type { V9UnboundTransaction as OwnedUnboundTransaction } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import { describe, expect, it } from 'vitest';
import type { UnboundTransaction as V1UnboundTransaction } from '../v1/TransactionOps.js';
import type { UnboundTransaction as V2UnboundTransaction } from '../v2/TransactionOps.js';

/** Compiles only when `A` is assignable to `B`. */
type AssertAssignable<A extends B, B> = [A, B];

// The V2 wallet's unbound transaction and the one the proving capability owns are one type, in both directions.
// This is what makes the wallet's declaration a re-export rather than a second opinion.
export type V2IsOwned = AssertAssignable<V2UnboundTransaction, OwnedUnboundTransaction>;
export type OwnedIsV2 = AssertAssignable<OwnedUnboundTransaction, V2UnboundTransaction>;

// The ledger-v8 one is NOT the same type, and must never be collapsed into it: it names the other ledger version's
// classes. Were this assignment to start compiling, the two ledgers would have become interchangeable in the type
// system while staying incompatible at runtime — which is the whole failure the fork work exists to prevent.
// @ts-expect-error - a ledger-v8 unbound transaction is not a ledger-v9 one.
export type V1IsNotOwned = AssertAssignable<V1UnboundTransaction, OwnedUnboundTransaction>;

describe('The unbound transaction each side of the fork names', () => {
  it('is a different class on each side, so no single declaration can stand for both', () => {
    // The type-level assertions above are erased at build time; this is the same fact standing at runtime. Two distinct
    // WASM modules are loaded, and a transaction built by one is not an instance of the other's class.
    expect(ledgerV8.Transaction).not.toBe(ledgerV9.Transaction);

    const v9Transaction = ledgerV9.Transaction.fromParts('undeployed');

    expect(v9Transaction).toBeInstanceOf(ledgerV9.Transaction);
    expect(v9Transaction).not.toBeInstanceOf(ledgerV8.Transaction);
  });
});
