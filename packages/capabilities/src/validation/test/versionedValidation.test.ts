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
 * Which validator answers for a transaction, on an SDK that runs a ledger version either side of a protocol boundary.
 *
 * @remarks
 *   Observed through real ledgers rather than labels, because the fact under test is that the two cannot read each other:
 *   a pre-fork transaction handed to the current ledger's `wellFormed` fails, and vice versa. A pass therefore proves
 *   the routing as surely as a failure does — nothing but the right validator can produce one.
 */
import * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Cause, Effect, Either, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { blockDataFrom, defaultLedgerParametersCodecs } from '../blockData.js';
import { UnsupportedValidationVersionError, WellFormedError, type BlockData } from '../validationService.js';
import { makeDefaultVersionedValidationServiceEffect } from '../versionedValidation.js';

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const NOW = new Date(1_752_487_200_000);

const FORK = ProtocolVersion.ProtocolVersion(2_000_000n);
const BEFORE_FORK = ProtocolVersion.ProtocolVersion(1n);

const NO_STRICTNESS = { enforceBalancing: false, verifySignatures: false, enforceLimits: false } as const;

/** A block as the indexer serves it, at `protocolVersion`, carrying the parameters of the matching ledger version. */
const blockAt = (protocolVersion: bigint, hex: string) => ({
  hash: '00'.repeat(32),
  height: 7,
  protocolVersion: Number(protocolVersion),
  ledgerParameters: hex,
  timestamp: NOW.getTime(),
});

const preForkHex = () => Buffer.from(preForkLedger.LedgerParameters.initialParameters().serialize()).toString('hex');
const postForkHex = () => Buffer.from(ledger.LedgerParameters.initialParameters().serialize()).toString('hex');

/** Reads a block the way the SDK's own fetcher does: with the codecs split at the same fork version. */
const blockDataAt = (protocolVersion: bigint, hex: string): BlockData =>
  Either.getOrThrow(blockDataFrom(defaultLedgerParametersCodecs(FORK), blockAt(protocolVersion, hex)));

const validator = (blockData: BlockData) =>
  makeDefaultVersionedValidationServiceEffect(
    {
      fetchBlockData: () => Promise.resolve(blockData),
      networkId: NETWORK_ID,
      clock: { now: () => NOW },
    },
    FORK,
  );

const failureOf = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error('expected the effect to fail');
  return Option.getOrThrow(Cause.failureOption(exit.cause));
};

describe('Validating at the version a transaction was authored for, either side of the fork', () => {
  it('checks a transaction authored before the fork with the pre-fork ledger version', async () => {
    const routed = validator(blockDataAt(1n, preForkHex()));

    await expect(
      Effect.runPromise(
        routed.validateTx(preForkLedger.Transaction.fromParts(NETWORK_ID), BEFORE_FORK, { flags: NO_STRICTNESS }),
      ),
    ).resolves.toBeUndefined();
  });

  it('checks a transaction authored from the fork with the current ledger version', async () => {
    const routed = validator(blockDataAt(FORK, postForkHex()));

    await expect(
      Effect.runPromise(routed.validateTx(ledger.Transaction.fromParts(NETWORK_ID), FORK, { flags: NO_STRICTNESS })),
    ).resolves.toBeUndefined();
  });

  it('refuses a pre-fork transaction offered at a post-fork version, rather than checking it with the wrong ledger', async () => {
    // The routing is on the transaction's own stamp, so this is a caller claiming the wrong epoch for its bytes. The
    // current ledger's `wellFormed` cannot read them, and says so.
    const routed = validator(blockDataAt(FORK, postForkHex()));

    const error = await failureOf(
      routed.validateTx(preForkLedger.Transaction.fromParts(NETWORK_ID), FORK, { flags: NO_STRICTNESS }),
    );

    expect(error).toBeInstanceOf(WellFormedError);
  });

  it('refuses a post-fork transaction offered at a pre-fork version, symmetrically', async () => {
    const routed = validator(blockDataAt(1n, preForkHex()));

    const error = await failureOf(
      routed.validateTx(ledger.Transaction.fromParts(NETWORK_ID), BEFORE_FORK, { flags: NO_STRICTNESS }),
    );

    expect(error).toBeInstanceOf(WellFormedError);
  });

  it('registers only the current ledger version when the chain has no epoch below the boundary', async () => {
    // With the boundary at the minimum supported version there is no pre-fork range at all, so a pre-fork stamp is a
    // version the registry genuinely does not cover — which is a different answer from "checked and malformed".
    const routed = makeDefaultVersionedValidationServiceEffect(
      {
        fetchBlockData: () => Promise.resolve(blockDataAt(FORK, postForkHex())),
        networkId: NETWORK_ID,
        clock: { now: () => NOW },
      },
      ProtocolVersion.MinSupportedVersion,
    );

    await expect(
      Effect.runPromise(routed.validateTx(ledger.Transaction.fromParts(NETWORK_ID), FORK, { flags: NO_STRICTNESS })),
    ).resolves.toBeUndefined();
  });

  it('names the version when nothing is registered for it at all', async () => {
    const routed = makeDefaultVersionedValidationServiceEffect(
      {
        fetchBlockData: () => Promise.resolve(blockDataAt(FORK, postForkHex())),
        networkId: NETWORK_ID,
        clock: { now: () => NOW },
      },
      FORK,
    );

    const belowMinimum = ProtocolVersion.ProtocolVersion(-1n);
    const error = await failureOf(
      routed.validateTx(ledger.Transaction.fromParts(NETWORK_ID), belowMinimum, { flags: NO_STRICTNESS }),
    );

    expect(error).toBeInstanceOf(UnsupportedValidationVersionError);
  });
});
