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
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import type { AnyTransaction, WalletFacade } from '../src/index.js';

const NETWORK_ID = NetworkId.NetworkId.Undeployed;

/** Compiles only when `A` is assignable to `B`. */
type AssertAssignable<A extends B, B> = [A, B];

// The name the facade exports is the very type its own public signatures take, in both directions — not a lookalike
// declared beside them that could drift. A caller who annotates with it can always call these methods.
export type AliasIsTheFeeParameter = AssertAssignable<
  AnyTransaction,
  Parameters<WalletFacade['calculateTransactionFee']>[0]
>;
export type FeeParameterIsTheAlias = AssertAssignable<
  Parameters<WalletFacade['calculateTransactionFee']>[0],
  AnyTransaction
>;
export type AliasIsTheRevertParameter = AssertAssignable<
  AnyTransaction,
  Parameters<WalletFacade['revertTransaction']>[0]
>;

describe('Naming the transactions the facade accepts, from the facade alone', () => {
  it('names every transaction shape its fee and revert methods take, without reaching into another package', () => {
    // Each binding is annotated with the facade's own exported name. That the annotations compile is the assertion:
    // before, a caller had to import the type from a dust-wallet variant subpath to write any of these lines.
    const unproven: AnyTransaction = ledger.Transaction.fromParts(NETWORK_ID);
    const finalized: AnyTransaction = ledger.Transaction.fromParts(NETWORK_ID).mockProve();
    const proofErased: AnyTransaction = ledger.Transaction.fromParts(NETWORK_ID).eraseProofs();

    expect(unproven).toBeInstanceOf(ledger.Transaction);
    expect(finalized).toBeInstanceOf(ledger.Transaction);
    expect(proofErased).toBeInstanceOf(ledger.Transaction);
  });
});
