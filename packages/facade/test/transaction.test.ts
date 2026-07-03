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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { describe, expect, it } from 'vitest';
import { txHistoryHash } from '../src/transaction.js';

const buildTransaction = () =>
  ledger.Transaction.fromParts('undeployed', undefined, undefined, ledger.Intent.new(new Date(Date.now() + 10_000)));

describe('txHistoryHash', () => {
  it('uses the ledger transaction hash for a finalized (proven + signed + bound) tx', () => {
    const tx = buildTransaction().mockProve().bind();
    expect(txHistoryHash(tx)).toBe(tx.transactionHash().toString());
  });

  it('falls back to the hex of the serialized bytes when transactionHash() is unavailable (e.g. proof-erased)', () => {
    const tx = buildTransaction().eraseProofs();
    expect(() => tx.transactionHash()).toThrow();
    expect(txHistoryHash(tx)).toBe(Buffer.from(tx.serialize()).toString('hex'));
  });

  it('is deterministic for a given tx, so the submit (pending) and revert (rejected) sides agree on the key', () => {
    const finalized = buildTransaction().mockProve().bind();
    const proofErased = buildTransaction().eraseProofs();
    expect(txHistoryHash(finalized)).toBe(txHistoryHash(finalized));
    expect(txHistoryHash(proofErased)).toBe(txHistoryHash(proofErased));
  });
});
