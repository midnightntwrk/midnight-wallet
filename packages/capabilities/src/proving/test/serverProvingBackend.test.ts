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
 * How many requests a proof server backend has in flight, as a wallet's proving configuration caps it.
 *
 * @remarks
 *   A wallet names its proof servers in its proving configuration and never touches the HTTP client that talks to them.
 *   So how many requests that client may have waiting at a server — which depends on how the server is run, and so on
 *   something only whoever configures the wallet knows — can only be said there, per backend, and has to arrive at the
 *   client as it was said. Both ledger versions' backends are built from the same description, and both have to honour
 *   it.
 *
 *   The requests are observed by standing in for `fetch`, because the client runs each request on its own runtime with
 *   its own HTTP layer. The stand-ins never answer with a real proof: the ledger refuses the result, and what is under
 *   test is the traffic that came before.
 */
import * as ledgerV8 from '@midnightntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Either } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DefaultProvingConfiguration } from '../provingService.js';
import { makeDefaultVersionedProvingServiceEffect, type AnyVersionUnprovenTransaction } from '../versionedProving.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);
const FORK = version(2_000_000n);
const FORKS: ProtocolVersion.ForkSchedule = { v9: FORK };
const V8_VERSION = version(5n);

const PROOF_SERVER = new URL('http://prover.test:6300');

/** The same proof server for both ledger versions, capped the same for both. */
const cappedAt = (maxConcurrentRequests: number): DefaultProvingConfiguration => ({
  provers: {
    v8: { kind: 'server', url: PROOF_SERVER, maxConcurrentRequests },
    v9: { kind: 'server', url: PROOF_SERVER, maxConcurrentRequests },
  },
});

/** A ledger-v8 transaction that needs one proof for each of its shielded outputs. */
const aV8TransactionOf = (outputs: number): ledgerV8.UnprovenTransaction => {
  const shielded = ledgerV8.shieldedToken();
  const offers = Array.from({ length: outputs }, () =>
    ledgerV8.ZswapOffer.fromOutput(
      ledgerV8.ZswapOutput.new(
        ledgerV8.createShieldedCoinInfo(shielded.raw, 1_000n),
        0,
        ledgerV8.sampleCoinPublicKey(),
        ledgerV8.sampleEncryptionPublicKey(),
      ),
      shielded.raw,
      1_000n,
    ),
  );
  return ledgerV8.Transaction.fromParts(
    'undeployed',
    offers.reduce((merged, offer) => merged.merge(offer)),
  );
};

/** A ledger-v9 transaction that needs one proof for each of its shielded outputs. */
const aV9TransactionOf = (outputs: number): ledgerV9.UnprovenTransaction => {
  const shielded = ledgerV9.shieldedToken();
  const offers = Array.from({ length: outputs }, () =>
    ledgerV9.ZswapOffer.fromOutput(
      ledgerV9.ZswapOutput.new(
        ledgerV9.createShieldedCoinInfo(shielded.raw, 1_000n),
        0,
        ledgerV9.sampleCoinPublicKey(),
        ledgerV9.sampleEncryptionPublicKey(),
      ),
      shielded.raw,
      1_000n,
    ),
  );
  return ledgerV9.Transaction.fromParts(
    'undeployed',
    offers.reduce((merged, offer) => merged.merge(offer)),
  );
};

/** Each ledger version's backend: the version its transactions are stamped with, and a transaction of its own. */
const backends: ReadonlyArray<{
  ledger: string;
  stamp: ProtocolVersion.ProtocolVersion;
  transactionOf: (outputs: number) => AnyVersionUnprovenTransaction;
}> = [
  { ledger: 'ledger-v8', stamp: V8_VERSION, transactionOf: aV8TransactionOf },
  { ledger: 'ledger-v9', stamp: FORK, transactionOf: aV9TransactionOf },
];

/**
 * A proof server that answers nothing until told to, so what a backend has waiting at it can be read off.
 *
 * @remarks
 *   A request is in flight from the moment it arrives until it is answered. Nothing is answered before
 *   `answerEverything`; from then on every request, held or yet to arrive, is answered as it stands.
 */
const aHeldProofServer = () => {
  const held: Array<() => void> = [];
  const traffic = { arrived: 0, inFlight: 0, peakInFlight: 0, answering: false };

  const fetch = (): Promise<Response> =>
    new Promise((resolve) => {
      traffic.arrived += 1;
      traffic.inFlight += 1;
      traffic.peakInFlight = Math.max(traffic.peakInFlight, traffic.inFlight);
      const answer = (): void => {
        traffic.inFlight -= 1;
        // Not a proof: the ledger will not take it for one, which no test here depends on.
        resolve(new Response('not a proof', { status: 200 }));
      };
      if (traffic.answering) answer();
      else held.push(answer);
    });

  return {
    fetch,
    arrived: (): number => traffic.arrived,
    inFlight: (): number => traffic.inFlight,
    peakInFlight: (): number => traffic.peakInFlight,
    answerEverything: (): void => {
      traffic.answering = true;
      held.splice(0).forEach((answer) => answer());
    },
  };
};

describe.each(backends)(
  'How many requests the $ledger proof server backend has in flight',
  ({ stamp, transactionOf }) => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    const proving = (maxConcurrentRequests: number, outputs: number) =>
      Effect.runPromiseExit(
        Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(cappedAt(maxConcurrentRequests), FORKS)).prove(
          transactionOf(outputs),
          stamp,
        ),
      );

    it('is never more at once than the `maxConcurrentRequests` its backend was configured with', async () => {
      const server = aHeldProofServer();
      globalThis.fetch = server.fetch;

      const proved = proving(3, 8);
      await vi.waitFor(() => expect(server.inFlight()).toBe(3));
      server.answerEverything();
      await proved;

      expect(server.peakInFlight()).toBe(3);
      expect(server.arrived()).toBe(8);
    });

    it('is never more at once than that across the transactions its backend is proving, because they queue at the same server', async () => {
      const server = aHeldProofServer();
      globalThis.fetch = server.fetch;
      const service = Either.getOrThrow(makeDefaultVersionedProvingServiceEffect(cappedAt(3), FORKS));

      const proved = Promise.all([
        Effect.runPromiseExit(service.prove(transactionOf(4), stamp)),
        Effect.runPromiseExit(service.prove(transactionOf(4), stamp)),
      ]);
      await vi.waitFor(() => expect(server.inFlight()).toBe(3));
      server.answerEverything();
      await proved;

      expect(server.peakInFlight()).toBe(3);
      expect(server.arrived()).toBe(8);
    });
  },
);
