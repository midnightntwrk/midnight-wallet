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
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  makePreForkValidationServiceEffect,
  type AnyPreForkValidatableTransaction,
} from '../preForkValidationService.js';
import { ValidationFetchError, WellFormedError, type BlockData } from '../validationService.js';

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const NOW = new Date(1_752_487_200_000);

const FULL_STRICTNESS = { enforceBalancing: true, verifySignatures: true, enforceLimits: true } as const;
const NO_STRICTNESS = { enforceBalancing: false, verifySignatures: false, enforceLimits: false } as const;

const preForkBlockData = (): BlockData<ledger.LedgerParameters> => ({
  hash: '00'.repeat(32),
  height: 7,
  protocolVersion: 0,
  ledgerParameters: ledger.LedgerParameters.initialParameters(),
  timestamp: NOW,
});

const deps = (fetchBlockData: () => Promise<BlockData<ledger.LedgerParameters>>) => ({
  fetchBlockData,
  networkId: NETWORK_ID,
  clock: { now: () => NOW },
});

const fetching = () => makePreForkValidationServiceEffect(deps(() => Promise.resolve(preForkBlockData())));

const failureOf = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error('expected the effect to fail');
  return Option.getOrThrow(Cause.failureOption(exit.cause));
};

// A pre-fork transaction built for a different network violates the non-configurable network-ID structural check.
const wrongNetworkTx = (): AnyPreForkValidatableTransaction =>
  ledger.Transaction.fromParts(NetworkId.NetworkId.MainNet);

// A pre-fork finalized transaction whose TTL is already past fails the non-configurable TTL structural check.
const expiredTx = (): AnyPreForkValidatableTransaction =>
  ledger.Transaction.fromParts(NETWORK_ID, undefined, undefined, ledger.Intent.new(new Date(0))).mockProve();

describe('Checking a pre-fork transaction against the pre-fork ledger', () => {
  it('passes a well-formed pre-fork transaction', async () => {
    const validator = fetching();

    await expect(
      Effect.runPromise(validator.validateTx(ledger.Transaction.fromParts(NETWORK_ID), { flags: NO_STRICTNESS })),
    ).resolves.toBeUndefined();
  });

  it('rejects a pre-fork transaction built for the wrong network', async () => {
    const error = await failureOf(fetching().validateTx(wrongNetworkTx(), { flags: FULL_STRICTNESS }));

    expect(error).toBeInstanceOf(WellFormedError);
  });

  it('rejects a pre-fork transaction whose TTL has already passed', async () => {
    const error = await failureOf(fetching().validateTx(expiredTx(), { flags: FULL_STRICTNESS }));

    expect(error).toBeInstanceOf(WellFormedError);
  });

  it('checks against the pre-fork parameters it is handed, without fetching', async () => {
    // The fetch is the only I/O in the path; a validator handed block data must not perform it. A fetcher that can
    // only fail is how that is observable — reaching it at all turns a pass into a `ValidationFetchError`.
    const validator = makePreForkValidationServiceEffect(
      deps(() => Promise.reject(new Error('the fetcher must not be reached'))),
    );

    await expect(
      Effect.runPromise(
        validator.validateTx(ledger.Transaction.fromParts(NETWORK_ID), {
          flags: NO_STRICTNESS,
          blockData: preForkBlockData(),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('reports a failed block-data fetch as a fetch failure, not a malformed transaction', async () => {
    const validator = makePreForkValidationServiceEffect(deps(() => Promise.reject(new Error('indexer unreachable'))));

    const error = await failureOf(
      validator.validateTx(ledger.Transaction.fromParts(NETWORK_ID), { flags: NO_STRICTNESS }),
    );

    expect(error).toBeInstanceOf(ValidationFetchError);
  });
});
