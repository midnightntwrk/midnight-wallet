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
 * What the HTTP prover client puts on the wire, per ledger version.
 *
 * @remarks
 *   A proof server speaks in payloads the ledger frames, so the client has one framing per ledger version and picks by
 *   which provider was asked for. The two framings happen to agree byte for byte on the preimages today's ledgers
 *   produce — which is exactly why this is worth pinning down rather than left to coincidence: what makes the request
 *   right is that the ledger which built the preimage also framed it, not that the other one would have agreed.
 *
 *   The requests are observed by standing in for `fetch`, because the client runs each request on its own runtime with
 *   its own HTTP layer, so there is no context a test could provide one through.
 */
import * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as HttpProverClient from '../HttpProverClient.js';

const PROVER_URL = new URL('http://prover.test:6300');

/** A request the client made, as the stand-in for `fetch` saw it. */
type ObservedRequest = Readonly<{ url: string; method: string; body: Uint8Array }>;

/** A check result the ledger's own parser reads as `[42n]`: the tagged, SCALE-encoded `vec(option(u64))`. */
const aCheckResponseBody = new Uint8Array(
  Buffer.concat([Buffer.from('midnight:vec(option(u64)):', 'utf8'), Buffer.from([0x04, 0x01, 42 << 2])]),
);

/**
 * A proof preimage as one ledger version's own transaction produces it.
 *
 * @remarks
 *   Taken from the ledger rather than written down as a fixture: the payload helpers refuse anything that is not a real
 *   preimage, and a preimage is only ever produced by the ledger version whose framing is under test. Proving is
 *   abandoned as soon as the first one has been seen — no proof is wanted here, only the bytes the ledger would have
 *   sent to a prover.
 */
const firstPreimageOf = async (
  prove: (provider: {
    check: () => Promise<(bigint | undefined)[]>;
    prove: (preimage: Uint8Array) => Promise<Uint8Array>;
    lookupKey: () => Promise<undefined>;
  }) => Promise<unknown>,
): Promise<Uint8Array> => {
  const seen: Uint8Array[] = [];
  await prove({
    check: () => Promise.resolve([]),
    prove: (preimage: Uint8Array) => {
      seen.push(preimage);
      return Promise.reject(new Error('enough: the preimage has been seen'));
    },
    lookupKey: () => Promise.resolve(undefined),
  }).then(
    () => undefined,
    () => undefined,
  );

  const preimage = seen.at(0);
  if (preimage === undefined) throw new Error('the ledger asked for no proof');
  return preimage;
};

const aPreForkPreimage = (): Promise<Uint8Array> => {
  const shielded = preForkLedger.shieldedToken();
  const coin = preForkLedger.createShieldedCoinInfo(shielded.raw, 1_000n);
  const output = preForkLedger.ZswapOutput.new(
    coin,
    0,
    preForkLedger.sampleCoinPublicKey(),
    preForkLedger.sampleEncryptionPublicKey(),
  );
  const transaction = preForkLedger.Transaction.fromParts(
    'undeployed',
    preForkLedger.ZswapOffer.fromOutput(output, shielded.raw, 1_000n),
  );
  return firstPreimageOf((provider) => transaction.prove(provider, preForkLedger.CostModel.initialCostModel()));
};

const aCurrentLedgerPreimage = (): Promise<Uint8Array> => {
  const shielded = ledger.shieldedToken();
  const coin = ledger.createShieldedCoinInfo(shielded.raw, 1_000n);
  const output = ledger.ZswapOutput.new(coin, 0, ledger.sampleCoinPublicKey(), ledger.sampleEncryptionPublicKey());
  const transaction = ledger.Transaction.fromParts(
    'undeployed',
    ledger.ZswapOffer.fromOutput(output, shielded.raw, 1_000n),
  );
  return firstPreimageOf((provider) => transaction.prove(provider, ledger.CostModel.initialCostModel()));
};

describe('What the HTTP prover client sends to a proof server', () => {
  const observed: ObservedRequest[] = [];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    observed.length = 0;
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      observed.push({
        url: input instanceof Request ? input.url : input.toString(),
        method: init?.method ?? 'GET',
        // Type cast required because: the client always sends a raw byte body, which `RequestInit` types only as the
        // whole `BodyInit` union.
        body: new Uint8Array(init?.body as Uint8Array),
      });
      return Promise.resolve(new Response(aCheckResponseBody, { status: 200 }));
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const client = () => Effect.runSync(HttpProverClient.create({ url: PROVER_URL }));

  it('frames a pre-fork proving request with the pre-fork ledger, and posts it to /prove', async () => {
    const preimage = await aPreForkPreimage();

    const proof = await client().asPreForkProvingProvider().prove(preimage, 'midnight/zswap/output', 7n);

    expect(observed).toHaveLength(1);
    expect(observed[0].url).toBe('http://prover.test:6300/prove');
    expect(observed[0].method).toBe('POST');
    expect(observed[0].body).toStrictEqual(preForkLedger.createProvingPayload(preimage, 7n));
    expect(proof).toStrictEqual(aCheckResponseBody);
  });

  it('frames a pre-fork check request with the pre-fork ledger, posts it to /check, and reads the reply with it', async () => {
    const preimage = await aPreForkPreimage();

    const result = await client().asPreForkProvingProvider().check(preimage, 'midnight/zswap/output');

    expect(observed).toHaveLength(1);
    expect(observed[0].url).toBe('http://prover.test:6300/check');
    expect(observed[0].body).toStrictEqual(preForkLedger.createCheckPayload(preimage));
    expect(result).toStrictEqual(preForkLedger.parseCheckResult(aCheckResponseBody));
  });

  it('frames a current-ledger proving request with the current ledger, unchanged', async () => {
    const preimage = await aCurrentLedgerPreimage();

    await client().asProvingProvider().prove(preimage, 'midnight/zswap/output', 7n);

    expect(observed).toHaveLength(1);
    expect(observed[0].url).toBe('http://prover.test:6300/prove');
    expect(observed[0].body).toStrictEqual(ledger.createProvingPayload(preimage, 7n));
  });

  it('frames a current-ledger check request with the current ledger, unchanged', async () => {
    const preimage = await aCurrentLedgerPreimage();

    const result = await client().asProvingProvider().check(preimage, 'midnight/zswap/output');

    expect(observed).toHaveLength(1);
    expect(observed[0].url).toBe('http://prover.test:6300/check');
    expect(observed[0].body).toStrictEqual(ledger.createCheckPayload(preimage));
    expect(result).toStrictEqual(ledger.parseCheckResult(aCheckResponseBody));
  });
});
