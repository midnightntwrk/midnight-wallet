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
 * Which key material each ledger version's in-process backend proves with.
 *
 * @remarks
 *   The backends share one prover and differ only in the key material they hand it: ledger-v8's circuits are generation
 *   9, ledger-v9's generation 10. A backend handed the other version's key material produces Dust spend proofs its node
 *   rejects, and nothing short of a node notices — the published ledger WASM builds do not verify Dust spend proofs —
 *   so which generation a backend asks for is pinned here, by what it requests first.
 *
 *   No network: the host is faked, and answers with bytes no pin accepts, so each proving attempt stops at its first
 *   request.
 */
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Either } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeV9WasmProvingServiceEffect } from '../provingService.js';
import { makeV8WasmProvingServiceEffect } from '../v8ProvingService.js';

const SRS = 'https://srs.midnight.network';

const aV8Transaction = (): ledgerV8.UnprovenTransaction => {
  const tokenType = ledgerV8.shieldedToken().raw;
  const recipient = ledgerV8.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
  const coin = ledgerV8.createShieldedCoinInfo(tokenType, 42n);
  const output = ledgerV8.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  return ledgerV8.Transaction.fromParts(
    NetworkId.NetworkId.Undeployed,
    ledgerV8.ZswapOffer.fromOutput(output, tokenType, 42n),
  );
};

const aV9Transaction = (): ledgerV9.UnprovenTransaction => {
  const tokenType = ledgerV9.shieldedToken().raw;
  const recipient = ledgerV9.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0));
  const coin = ledgerV9.createShieldedCoinInfo(tokenType, 42n);
  const output = ledgerV9.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  return ledgerV9.Transaction.fromParts(
    NetworkId.NetworkId.Undeployed,
    ledgerV9.ZswapOffer.fromOutput(output, tokenType, 42n),
  );
};

describe("Each ledger version's in-process backend", () => {
  const requested: string[] = [];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    requested.length = 0;
    globalThis.fetch = (input: string | URL | Request) => {
      requested.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("proves ledger-v8 transactions with ledger-v8's key material, generation 9", async () => {
    const result = await makeV8WasmProvingServiceEffect()
      .prove(aV8Transaction())
      .pipe(Effect.either, Effect.runPromise);

    expect(Either.isLeft(result)).toBe(true);
    expect(requested[0]).toBe(`${SRS}/zswap/9/output.prover`);
  });

  it("proves ledger-v9 transactions with ledger-v9's key material, generation 10", async () => {
    const result = await makeV9WasmProvingServiceEffect()
      .prove(aV9Transaction())
      .pipe(Effect.either, Effect.runPromise);

    expect(Either.isLeft(result)).toBe(true);
    expect(requested[0]).toBe(`${SRS}/zswap/10/output.prover`);
  });
});
