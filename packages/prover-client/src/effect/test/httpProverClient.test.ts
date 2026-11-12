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
import * as ledgerV8 from '@midnightntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { Cause, Effect, Exit, Option, Schedule } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const aV8Preimage = (): Promise<Uint8Array> => {
  const shielded = ledgerV8.shieldedToken();
  const coin = ledgerV8.createShieldedCoinInfo(shielded.raw, 1_000n);
  const output = ledgerV8.ZswapOutput.new(
    coin,
    0,
    ledgerV8.sampleCoinPublicKey(),
    ledgerV8.sampleEncryptionPublicKey(),
  );
  const transaction = ledgerV8.Transaction.fromParts(
    'undeployed',
    ledgerV8.ZswapOffer.fromOutput(output, shielded.raw, 1_000n),
  );
  return firstPreimageOf((provider) => transaction.prove(provider, ledgerV8.CostModel.initialCostModel()));
};

const aV9Preimage = (): Promise<Uint8Array> => {
  const shielded = ledgerV9.shieldedToken();
  const coin = ledgerV9.createShieldedCoinInfo(shielded.raw, 1_000n);
  const output = ledgerV9.ZswapOutput.new(
    coin,
    0,
    ledgerV9.sampleCoinPublicKey(),
    ledgerV9.sampleEncryptionPublicKey(),
  );
  const transaction = ledgerV9.Transaction.fromParts(
    'undeployed',
    ledgerV9.ZswapOffer.fromOutput(output, shielded.raw, 1_000n),
  );
  return firstPreimageOf((provider) => transaction.prove(provider, ledgerV9.CostModel.initialCostModel()));
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

  it('frames a ledger-v8 proving request with it, and posts it to /prove', async () => {
    const preimage = await aV8Preimage();

    const proof = await client().asV8ProvingProvider().prove(preimage, 'midnight/zswap/output', 7n);

    expect(observed).toHaveLength(1);
    expect(observed[0].url).toBe('http://prover.test:6300/prove');
    expect(observed[0].method).toBe('POST');
    expect(observed[0].body).toStrictEqual(ledgerV8.createProvingPayload(preimage, 7n));
    expect(proof).toStrictEqual(aCheckResponseBody);
  });

  it('frames a ledger-v8 check request with it, posts it to /check, and reads the reply with it', async () => {
    const preimage = await aV8Preimage();

    const result = await client().asV8ProvingProvider().check(preimage, 'midnight/zswap/output');

    expect(observed).toHaveLength(1);
    expect(observed[0].url).toBe('http://prover.test:6300/check');
    expect(observed[0].body).toStrictEqual(ledgerV8.createCheckPayload(preimage));
    expect(result).toStrictEqual(ledgerV8.parseCheckResult(aCheckResponseBody));
  });

  it('frames a ledger-v9 proving request with ledger-v9, unchanged', async () => {
    const preimage = await aV9Preimage();

    await client().asProvingProvider().prove(preimage, 'midnight/zswap/output', 7n);

    expect(observed).toHaveLength(1);
    expect(observed[0].url).toBe('http://prover.test:6300/prove');
    expect(observed[0].body).toStrictEqual(ledgerV9.createProvingPayload(preimage, 7n));
  });

  it('frames a ledger-v9 check request with ledger-v9, unchanged', async () => {
    const preimage = await aV9Preimage();

    const result = await client().asProvingProvider().check(preimage, 'midnight/zswap/output');

    expect(observed).toHaveLength(1);
    expect(observed[0].url).toBe('http://prover.test:6300/check');
    expect(observed[0].body).toStrictEqual(ledgerV9.createCheckPayload(preimage));
    expect(result).toStrictEqual(ledgerV9.parseCheckResult(aCheckResponseBody));
  });
});

/**
 * The places a proof server has in its queue as released: its `--job-capacity`, 10.
 *
 * @remarks
 *   A job holds a place from the moment it arrives until a worker takes it. The server's workers run beside the queue,
 *   but a job they have not got to yet still holds its place, so the queue is all the room a client that sends its
 *   requests at once can count on, however many workers there are.
 */
const RELEASED_QUEUE_PLACES = 10;

/**
 * A proof server that answers nothing until told to, so what a client has waiting at it can be read off.
 *
 * @remarks
 *   A request is in flight from the moment it arrives until it is answered. Nothing is answered before
 *   `answerEverything`, which is what lets a test see how many requests a client sends without an answer to any of
 *   them; from then on every request, held or yet to arrive, is answered as it stands.
 *
 *   Given a number of places, it refuses a request that finds them all taken the way a proof server refuses one that
 *   finds its queue full: with `429 Job Queue full`, the request never having been in flight.
 */
const aHeldProofServer = (places: number = Number.POSITIVE_INFINITY) => {
  const held: Array<() => void> = [];
  const traffic = { arrived: 0, refused: 0, inFlight: 0, peakInFlight: 0, answering: false };

  const fetch = (): Promise<Response> =>
    new Promise((resolve) => {
      traffic.arrived += 1;
      if (traffic.inFlight >= places) {
        traffic.refused += 1;
        resolve(new Response('Job Queue full', { status: 429 }));
        return;
      }
      traffic.inFlight += 1;
      traffic.peakInFlight = Math.max(traffic.peakInFlight, traffic.inFlight);
      const answer = (): void => {
        traffic.inFlight -= 1;
        resolve(new Response(aCheckResponseBody, { status: 200 }));
      };
      if (traffic.answering) answer();
      else held.push(answer);
    });

  return {
    fetch,
    arrived: (): number => traffic.arrived,
    refused: (): number => traffic.refused,
    inFlight: (): number => traffic.inFlight,
    peakInFlight: (): number => traffic.peakInFlight,
    answerEverything: (): void => {
      traffic.answering = true;
      held.splice(0).forEach((answer) => answer());
    },
  };
};

/**
 * How many requests the HTTP prover client has waiting at a proof server at once.
 *
 * @remarks
 *   A ledger asks for every proof of a transaction at once, and a proof server only has room for so many: it refuses the
 *   ones past its queue, and one refused proof fails the whole transaction. So the client holds requests back itself,
 *   and sends the next one only as an earlier one is answered. A proof server queues `/check` and `/prove` requests in
 *   the same place, so the client counts them together.
 */
describe('How many requests the HTTP prover client has in flight at a proof server', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const aProofServer = (places?: number) => {
    const server = aHeldProofServer(places);
    globalThis.fetch = server.fetch;
    return server;
  };

  it('is never more than the configured cap, so a transaction with more proofs than the server queues is not refused', async () => {
    const server = aProofServer();
    const provider = Effect.runSync(
      HttpProverClient.create({ url: PROVER_URL, maxConcurrentRequests: 3 }),
    ).asProvingProvider();
    const preimage = await aV9Preimage();

    const proving = Promise.all(Array.from({ length: 8 }, () => provider.prove(preimage, 'midnight/zswap/output')));
    await vi.waitFor(() => expect(server.inFlight()).toBe(3));
    server.answerEverything();
    await proving;

    expect(server.peakInFlight()).toBe(3);
    expect(server.arrived()).toBe(8);
  });

  it('is never more than a proof server queues as released when no cap is configured, so none of them is refused', async () => {
    const server = aProofServer(RELEASED_QUEUE_PLACES);
    const provider = Effect.runSync(HttpProverClient.create({ url: PROVER_URL })).asProvingProvider();
    const preimage = await aV9Preimage();

    const proving = Promise.allSettled(
      Array.from({ length: 14 }, () => provider.prove(preimage, 'midnight/zswap/output')),
    );
    await vi.waitFor(() => expect(server.inFlight()).toBe(RELEASED_QUEUE_PLACES));
    server.answerEverything();
    await proving;

    expect(server.refused()).toBe(0);
    expect(server.arrived()).toBe(14);
  });

  it('counts check and prove requests together, because they wait in the same queue at the server', async () => {
    const server = aProofServer();
    const provider = Effect.runSync(
      HttpProverClient.create({ url: PROVER_URL, maxConcurrentRequests: 3 }),
    ).asProvingProvider();
    const preimage = await aV9Preimage();

    const working = Promise.all([
      ...Array.from({ length: 4 }, () => provider.prove(preimage, 'midnight/zswap/output')),
      ...Array.from({ length: 4 }, () => provider.check(preimage, 'midnight/zswap/output')),
    ]);
    await vi.waitFor(() => expect(server.inFlight()).toBe(3));
    server.answerEverything();
    await working;

    expect(server.peakInFlight()).toBe(3);
    expect(server.arrived()).toBe(8);
  });
});

/**
 * What the HTTP prover client makes of a cap that is not a number of requests.
 *
 * @remarks
 *   A cap counts the requests a client may have waiting: a whole number of them, and at least one. Nothing else has a
 *   reading that sends a request — a client capped at none waits forever before its first — so such a client is not
 *   created at all, and whoever configured it is told so rather than left with proofs that never come.
 */
describe('A cap on the requests the HTTP prover client has in flight', () => {
  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'cannot be %s, because it counts requests: a whole number of them, and at least one',
    (cap) => {
      const exit = Effect.runSyncExit(HttpProverClient.create({ url: PROVER_URL, maxConcurrentRequests: cap }));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(Exit.isFailure(exit) ? Option.getOrUndefined(Cause.failureOption(exit.cause)) : undefined).toMatchObject({
        _tag: '@midnightntwrk/wallet-sdk-prover-client/effect/HttpProverClient/InvalidMaxConcurrentRequestsError',
      });
    },
  );
});

/** What a proof server answers one request with. */
type Answer = Readonly<{
  status: number;
  body: string | Uint8Array<ArrayBuffer> | (() => ReadableStream<Uint8Array>);
}>;

/** A body that breaks off before it can be read, as a reply cut short on its way does. */
const aBrokenBody = (): ReadableStream<Uint8Array> =>
  new ReadableStream({ start: (controller) => controller.error(new Error('the reply broke off')) });

const aProof: Answer = { status: 200, body: aCheckResponseBody };

/** What a proof server says to a request that finds its queue full. */
const queueFull: Answer = { status: 429, body: 'Job Queue full' };

/**
 * A proof server that answers from a script: each request takes the next answer, and the last one stands for every
 * request after it.
 */
const aScriptedProofServer = (script: readonly [Answer, ...Answer[]]) => {
  const traffic = { arrived: 0 };

  const fetch = (): Promise<Response> => {
    const answer = script[Math.min(traffic.arrived, script.length - 1)];
    traffic.arrived += 1;
    return Promise.resolve(
      new Response(typeof answer.body === 'function' ? answer.body() : answer.body, { status: answer.status }),
    );
  };

  return { fetch, arrived: (): number => traffic.arrived };
};

/**
 * What the HTTP prover client does with a request the proof server does not take.
 *
 * @remarks
 *   A proof server refuses a request that finds its queue full, and a queue empties as proofs are made: the same request
 *   a little later is taken. The same goes for an answer that never came from the server at all, but from something
 *   between the client and it giving way. So those are sent again, as the client's retry schedule allows, and only an
 *   answer that sending again cannot change, or a schedule that has run out, fails the proof.
 *
 *   The schedules here recur without waiting, so that what is under test is which answers are sent again and how often,
 *   not how long a client waits in between.
 */
describe('What the HTTP prover client does with a request the proof server does not take', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const aProofServerAnswering = (...script: readonly [Answer, ...Answer[]]) => {
    const server = aScriptedProofServer(script);
    globalThis.fetch = server.fetch;
    return server;
  };

  const aProviderRetrying = (retrySchedule: Schedule.Schedule<unknown, unknown>) =>
    Effect.runSync(HttpProverClient.create({ url: PROVER_URL, retrySchedule })).asProvingProvider();

  it('sends it again when the queue was full, and takes the proof once the server has room', async () => {
    const server = aProofServerAnswering(queueFull, queueFull, aProof);
    const provider = aProviderRetrying(Schedule.recurs(4));
    const preimage = await aV9Preimage();

    await expect(provider.prove(preimage, 'midnight/zswap/output')).resolves.toStrictEqual(aCheckResponseBody);
    expect(server.arrived()).toBe(3);
  });

  it.each([502, 503, 504])(
    'sends it again when the answer was %s, because what gave way between it and the server may hold the next time',
    async (status) => {
      const server = aProofServerAnswering({ status, body: 'no answer from the proof server' }, aProof);
      const provider = aProviderRetrying(Schedule.recurs(4));
      const preimage = await aV9Preimage();

      await expect(provider.prove(preimage, 'midnight/zswap/output')).resolves.toStrictEqual(aCheckResponseBody);
      expect(server.arrived()).toBe(2);
    },
  );

  it.each([429, 502, 503, 504])(
    'sends it again when the answer was %s and broke off before it could be read, because the status alone says it may pass',
    async (status) => {
      const server = aProofServerAnswering({ status, body: aBrokenBody }, aProof);
      const provider = aProviderRetrying(Schedule.recurs(4));
      const preimage = await aV9Preimage();

      await expect(provider.prove(preimage, 'midnight/zswap/output')).resolves.toStrictEqual(aCheckResponseBody);
      expect(server.arrived()).toBe(2);
    },
  );

  it('gives up once its retries are spent, and says what the server said last', async () => {
    const server = aProofServerAnswering(queueFull);
    const provider = aProviderRetrying(Schedule.recurs(2));
    const preimage = await aV9Preimage();

    await expect(provider.prove(preimage, 'midnight/zswap/output')).rejects.toThrow('Failed to prove: Job Queue full');
    expect(server.arrived()).toBe(3);
  });

  it.each([
    { status: 400, body: 'not a proof preimage' },
    { status: 500, body: 'internal error' },
  ])(
    'does not send it again when the answer was $status, because the same request would get the same answer',
    async (answer) => {
      const server = aProofServerAnswering(answer);
      const provider = aProviderRetrying(Schedule.recurs(4));
      const preimage = await aV9Preimage();

      await expect(provider.prove(preimage, 'midnight/zswap/output')).rejects.toThrow(
        `Failed to prove: ${answer.body}`,
      );
      expect(server.arrived()).toBe(1);
    },
  );
});

/**
 * Reads off whether a proof has been made, has failed, or is still being waited for, without waiting for it.
 *
 * @remarks
 *   Also takes the proof's failure off the promise, so that one a test never awaits is not reported as unhandled.
 */
const watching = (proving: Promise<unknown>): (() => 'waiting' | 'proved' | 'failed') => {
  const seen: { outcome: 'waiting' | 'proved' | 'failed' } = { outcome: 'waiting' };
  proving.then(
    () => {
      seen.outcome = 'proved';
    },
    () => {
      seen.outcome = 'failed';
    },
  );
  return () => seen.outcome;
};

const seconds = (count: number): number => count * 1_000;

/**
 * How the HTTP prover client sends a request again when it was not told how.
 *
 * @remarks
 *   The schedule a client runs with unless it is given one is what carries a transaction through a proof server that is
 *   busy with someone else's proofs, so it is pinned here as a client with no schedule of its own behaves: it waits
 *   about a second before the first retry, comes back at most about ten seconds apart, and gives up after five
 *   minutes.
 *
 *   Time is the test's own: the waits are jittered by a fifth either way, so each bound is taken on the far side of that.
 */
describe('How the HTTP prover client sends a request again when it was not told how', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
  });

  const aProofServerAnswering = (...script: readonly [Answer, ...Answer[]]) => {
    const server = aScriptedProofServer(script);
    globalThis.fetch = server.fetch;
    return server;
  };

  const aProvider = () => Effect.runSync(HttpProverClient.create({ url: PROVER_URL })).asProvingProvider();

  it('waits about a second before sending a refused request again, and takes the proof it then gets', async () => {
    const preimage = await aV9Preimage();
    vi.useFakeTimers();
    const server = aProofServerAnswering(queueFull, aProof);

    const proving = aProvider().prove(preimage, 'midnight/zswap/output');
    const outcome = watching(proving);

    await vi.advanceTimersByTimeAsync(799);
    expect(server.arrived()).toBe(1);
    expect(outcome()).toBe('waiting');

    await vi.advanceTimersByTimeAsync(401);
    expect(server.arrived()).toBe(2);
    await expect(proving).resolves.toStrictEqual(aCheckResponseBody);
  });

  it('keeps sending a request the server keeps refusing for 5 minutes, at most about 10 seconds apart, and then gives up with what the server said', async () => {
    const preimage = await aV9Preimage();
    vi.useFakeTimers();
    const server = aProofServerAnswering(queueFull);

    const proving = aProvider().prove(preimage, 'midnight/zswap/output');
    const outcome = watching(proving);

    await vi.advanceTimersByTimeAsync(seconds(285));
    expect(outcome()).toBe('waiting');

    // Past five minutes by the longest a last wait can be.
    await vi.advanceTimersByTimeAsync(seconds(28));
    expect(outcome()).toBe('failed');
    await expect(proving).rejects.toThrow('Failed to prove: Job Queue full');

    // One request, four more as the waits double from one second to eight, then one about every ten seconds.
    expect(server.arrived()).toBeGreaterThanOrEqual(25);
    expect(server.arrived()).toBeLessThanOrEqual(45);
  });
});

/**
 * What the HTTP prover client does with a request the proof server never answers.
 *
 * @remarks
 *   A request holds one of the client's places in flight until its reply has been read, so a request that is never
 *   answered — a connection that went quiet without closing — would hold its place for good, and enough of them would
 *   leave a client unable to send anything. So a request is given up after ten minutes, which is as long as a proof
 *   server lets a job run as released: no proof it would have made is lost. It is not sent again, because a request
 *   still waiting after that long may be a proof still being made, and sending it again would have it made twice.
 */
describe('What the HTTP prover client does with a request the proof server never answers', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
  });

  const aSilentProofServer = () => {
    const server = aHeldProofServer();
    globalThis.fetch = server.fetch;
    return server;
  };

  it('gives it up after 10 minutes, and does not send it again', async () => {
    const preimage = await aV9Preimage();
    vi.useFakeTimers();
    const server = aSilentProofServer();
    const provider = Effect.runSync(
      HttpProverClient.create({ url: PROVER_URL, retrySchedule: Schedule.recurs(4) }),
    ).asProvingProvider();

    const proving = provider.prove(preimage, 'midnight/zswap/output');
    const outcome = watching(proving);

    await vi.advanceTimersByTimeAsync(seconds(599));
    expect(outcome()).toBe('waiting');

    await vi.advanceTimersByTimeAsync(seconds(1));
    expect(outcome()).toBe('failed');
    await expect(proving).rejects.toThrow('Failed to prove: the Proof Server did not answer within 10 minutes');
    expect(server.arrived()).toBe(1);
  });

  it('frees its place when it gives it up, so requests that are never answered do not hold up the ones behind them for good', async () => {
    const preimage = await aV9Preimage();
    vi.useFakeTimers();
    const server = aSilentProofServer();
    const provider = Effect.runSync(
      HttpProverClient.create({ url: PROVER_URL, maxConcurrentRequests: 1 }),
    ).asProvingProvider();

    watching(provider.prove(preimage, 'midnight/zswap/output'));
    watching(provider.prove(preimage, 'midnight/zswap/output'));

    await vi.advanceTimersByTimeAsync(seconds(599));
    expect(server.arrived()).toBe(1);

    await vi.advanceTimersByTimeAsync(seconds(1));
    expect(server.arrived()).toBe(2);
  });
});
