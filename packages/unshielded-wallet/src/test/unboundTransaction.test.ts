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
import * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import * as postForkLedger from '@midnightntwrk/ledger-v9';
import type { UnboundTransaction as OwnedUnboundTransaction } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import { describe, expect, it } from 'vitest';
import type { UnboundTransaction as PreForkUnboundTransaction } from '../v1/TransactionOps.js';
import type { UnboundTransaction as PostForkUnboundTransaction } from '../v2/TransactionOps.js';

/** Compiles only when `A` is assignable to `B`. */
type AssertAssignable<A extends B, B> = [A, B];

// The post-fork wallet's unbound transaction and the one the proving capability owns are one type, in both directions.
// This is what makes the wallet's declaration a re-export rather than a second opinion.
export type PostForkIsOwned = AssertAssignable<PostForkUnboundTransaction, OwnedUnboundTransaction>;
export type OwnedIsPostFork = AssertAssignable<OwnedUnboundTransaction, PostForkUnboundTransaction>;

// The pre-fork one is NOT the same type, and must never be collapsed into it: it names the other ledger version's
// classes. Were this assignment to start compiling, the two ledgers would have become interchangeable in the type
// system while staying incompatible at runtime — which is the whole failure the fork work exists to prevent.
// @ts-expect-error - a pre-fork unbound transaction is not a post-fork one.
export type PreForkIsNotOwned = AssertAssignable<PreForkUnboundTransaction, OwnedUnboundTransaction>;

describe('The unbound transaction each side of the fork names', () => {
  it('is a different class on each side, so no single declaration can stand for both', () => {
    // The type-level assertions above are erased at build time; this is the same fact standing at runtime. Two distinct
    // WASM modules are loaded, and a transaction built by one is not an instance of the other's class.
    expect(preForkLedger.Transaction).not.toBe(postForkLedger.Transaction);

    const postForkTransaction = postForkLedger.Transaction.fromParts('undeployed');

    expect(postForkTransaction).toBeInstanceOf(postForkLedger.Transaction);
    expect(postForkTransaction).not.toBeInstanceOf(preForkLedger.Transaction);
  });
});
