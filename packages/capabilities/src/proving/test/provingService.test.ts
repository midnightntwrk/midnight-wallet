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
import { type CanAssign, type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Proving from '../index.js';
import {
  makeV9ServerProvingService,
  makeV9SimulatorProvingServiceEffect,
  makeVersionedProvingServiceEffect,
  ProvingError,
  UnsupportedProvingVersionError,
  wrapVersionedEffectService,
  type ProvingService,
  type ProvingServiceEffect,
  type ProvingServices,
  type V9ProvingServiceEffect,
  type V9UnboundTransaction,
  type V9UnprovenTransaction,
  type VersionedProvingService,
  type VersionedProvingServiceEffect,
} from '../provingService.js';
import {
  type V8ProvingServiceEffect,
  type V8UnboundTransaction,
  type V8UnprovenTransaction,
} from '../v8ProvingService.js';
import {
  type AnyVersionUnboundTransaction,
  type AnyVersionUnprovenTransaction,
  type VersionProvingServiceEffect,
} from '../versionedProving.js';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';

const getNonDustImbalance = (imbalances: Map<ledger.TokenType, bigint>, rawTokenType: ledger.RawTokenType): bigint => {
  const [, value] = Array.from(imbalances.entries()).find(([t, value]) =>
    t.tag !== 'dust' && t.raw == rawTokenType ? value : undefined,
  ) ?? [undefined, BigInt(0)];

  return value;
};

const makeTransaction = () => {
  const seed = Buffer.alloc(32, 0);
  const recipient = ledger.ZswapSecretKeys.fromSeed(seed);
  const amount = 42n;
  const shieldedTokenType = ledger.shieldedToken();
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, amount);
  const output = ledger.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenType.raw, amount);
  return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer);
};

describe('Simulator proving service', () => {
  const testUnprovenTx = makeTransaction();

  it('does transform unproven transaction into proof-erased transaction', async () => {
    const service = makeV9SimulatorProvingServiceEffect();
    const finalTx: ledger.ProofErasedTransaction = await service.prove(testUnprovenTx).pipe(Effect.runPromise);

    expect(finalTx).toBeInstanceOf(ledger.Transaction);
    expect(() =>
      ledger.Transaction.deserialize('signature', 'no-proof', 'no-binding', finalTx.serialize()),
    ).not.toThrow();
    expect(getNonDustImbalance(finalTx.imbalances(0), ledger.shieldedToken().raw)).toEqual(-42n);
  });
});

describe('Naming the ledger version a proving backend is written against', () => {
  it('requires every proving type to name the transaction it accepts, so none is ledger-v9 by omission', () => {
    // @ts-expect-error a backend names the unproven transaction it accepts
    type _1 = ProvingServiceEffect<V9UnboundTransaction>;
    // @ts-expect-error a backend names the unproven transaction it accepts
    type _2 = ProvingService<V9UnboundTransaction>;
    // @ts-expect-error a version-routed service names the unproven transactions it accepts
    type _3 = VersionedProvingServiceEffect<V9UnboundTransaction>;
    // @ts-expect-error a version-routed service names the unproven transactions it accepts
    type _4 = VersionedProvingService<V9UnboundTransaction>;
    // @ts-expect-error a registry names the unproven transactions its backends accept
    type _5 = ProvingServices<V9UnboundTransaction>;
  });

  it('names the ledger version of every backend that is built over one', () => {
    expect(Proving).toHaveProperty('makeV9SimulatorProvingServiceEffect');
    expect(Proving).toHaveProperty('makeV9SimulatorProvingService');
    expect(Proving).toHaveProperty('makeV9WasmProvingServices');
    expect(Proving).not.toHaveProperty('makeSimulatorProvingServiceEffect');
    expect(Proving).not.toHaveProperty('makeSimulatorProvingService');
    expect(Proving).not.toHaveProperty('makeWasmProvingServices');
  });

  it('offers no version-less name for the ledger-v9 proof server, which is makeV9ServerProvingService', () => {
    expect(Proving).not.toHaveProperty('makeDefaultProvingServiceEffect');
    expect(Proving).not.toHaveProperty('makeDefaultProvingService');
  });
});

describe('Telling a backend over one ledger version from one over both', () => {
  it('refuses a backend over one ledger version where either ledger version may be handed to it', () => {
    // Each ledger version's backend reads only that version's transactions, so it is no backend for a router that
    // may hand it the other's: that transaction would reach a ledger that cannot read it.
    type _1 = Expect<Equal<CanAssign<V8ProvingServiceEffect, VersionProvingServiceEffect>, false>>;
    type _2 = Expect<Equal<CanAssign<V9ProvingServiceEffect, VersionProvingServiceEffect>, false>>;
    type _3 = Expect<
      Equal<
        CanAssign<
          ProvingService<V9UnboundTransaction, V9UnprovenTransaction>,
          ProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>
        >,
        false
      >
    >;
    type _4 = Expect<
      Equal<
        CanAssign<
          VersionedProvingServiceEffect<V8UnboundTransaction, V8UnprovenTransaction>,
          VersionedProvingServiceEffect<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>
        >,
        false
      >
    >;
    type _5 = Expect<
      Equal<
        CanAssign<
          VersionedProvingService<V8UnboundTransaction, V8UnprovenTransaction>,
          VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>
        >,
        false
      >
    >;
    type _6 = Expect<
      Equal<
        CanAssign<
          ProvingService<V9UnboundTransaction, V9UnprovenTransaction>,
          VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>
        >,
        false
      >
    >;
  });

  it('takes a backend that reads more transactions than it is asked to', () => {
    type _1 = Expect<
      CanAssign<ProvingServiceEffect<V9UnboundTransaction, AnyVersionUnprovenTransaction>, V9ProvingServiceEffect>
    >;
  });

  it('names the promise-facing ledger-v9 backend as it names the effect one', () => {
    type _1 = Expect<Equal<Proving.V9ProvingService, ProvingService<V9UnboundTransaction, V9UnprovenTransaction>>>;
  });
});

describe('Proving behind a promise', () => {
  /** What a promise was rejected with, or nothing when it resolved. */
  const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => undefined,
      (error: unknown) => error,
    );

  it('rejects with the failure itself, so a caller can catch the class the backend names', async () => {
    // A proof server URL no HTTP client can dial fails before any request is made.
    const proving = makeV9ServerProvingService({ provingServerUrl: new URL('ftp://localhost:6300') });

    expect(await rejectionOf(proving.prove(makeTransaction()))).toBeInstanceOf(ProvingError);
  });

  it('rejects a version-routed proof with the failure itself too', async () => {
    const proving = wrapVersionedEffectService(
      makeVersionedProvingServiceEffect<V9UnboundTransaction, V9UnprovenTransaction>({ entries: [] }),
    );

    const rejection = await rejectionOf(proving.prove(makeTransaction(), ProtocolVersion.MinSupportedVersion));

    expect(rejection).toBeInstanceOf(UnsupportedProvingVersionError);
  });
});
