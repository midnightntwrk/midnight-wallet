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
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { Serialization as DustV1Serialization } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { Serialization as DustV2Serialization } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import {
  DefaultForkSchedule,
  WalletEntrySchema,
  finalizedTransactionTraits,
  mergeWalletEntries,
} from '@midnightntwrk/wallet-sdk-facade';
import { Serialization as ShieldedV1Serialization } from '@midnightntwrk/wallet-sdk-shielded/v1';
import { Serialization as ShieldedV2Serialization } from '@midnightntwrk/wallet-sdk-shielded/v2';
import { Serialization as UnshieldedV1Serialization } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { Serialization as UnshieldedV2Serialization } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { fixturesFor, type Fixture, type Surface, type Writer } from './fixtures.js';

/**
 * The registry the wallet itself reads pending transactions with, built from the fork schedule the facade presets, so a
 * payload is rewritten here exactly as it would be by a wallet an application hands it back to.
 */
const pendingTxTraits = finalizedTransactionTraits(DefaultForkSchedule.v9);

type Rewriter = (serialized: string) => Promise<string> | string;

/** The surfaces with one writer outside the twins, rewritten the same way whichever variant a case is filed under. */
const singleWriterRewriters: Pick<Record<Surface, Rewriter>, 'tx-history' | 'pending-transactions'> = {
  'tx-history': (s) =>
    EitherOps.getOrThrowLeft(
      InMemoryTransactionHistoryStorage.restore(s, WalletEntrySchema, mergeWalletEntries),
    ).serialize(),
  'pending-transactions': (s) =>
    PendingTransactions.serialize(
      EitherOps.getOrThrowLeft(PendingTransactions.deserialize(s, pendingTxTraits)),
      pendingTxTraits,
    ),
};

const shieldedV1 = ShieldedV1Serialization.makeDefaultV1SerializationCapability();
const shieldedV2 = ShieldedV2Serialization.makeDefaultV2SerializationCapability();
const unshieldedV1 = UnshieldedV1Serialization.makeDefaultV1SerializationCapability();
const unshieldedV2 = UnshieldedV2Serialization.makeDefaultV2SerializationCapability();
const dustV1 = DustV1Serialization.makeDefaultV1SerializationCapability();
const dustV2 = DustV2Serialization.makeDefaultV2SerializationCapability();

/**
 * Restore a stored payload with the current code and write it straight back out, per writer and surface.
 *
 * Used by the drift test to compare against the recorded baseline, and by the same test in capture mode to record a new
 * one. One implementation for both, so the thing being recorded and the thing being checked can never diverge. Both
 * variants are here because both are writers of these surfaces: what the V2 variant writes from `forks.v9` is as much a
 * persisted format as what the V1 variant writes below it.
 */
const rewriters: Record<Writer, Record<Surface, Rewriter>> = {
  v1: {
    shielded: (s) => shieldedV1.serialize(EitherOps.getOrThrowLeft(shieldedV1.deserialize(null, s))),
    unshielded: (s) => unshieldedV1.serialize(EitherOps.getOrThrowLeft(unshieldedV1.deserialize(s))),
    dust: (s) => dustV1.serialize(EitherOps.getOrThrowLeft(dustV1.deserialize(null, s))),
    ...singleWriterRewriters,
  },
  v2: {
    shielded: (s) => shieldedV2.serialize(EitherOps.getOrThrowLeft(shieldedV2.deserialize(null, s))),
    unshielded: (s) => unshieldedV2.serialize(EitherOps.getOrThrowLeft(unshieldedV2.deserialize(s))),
    dust: (s) => dustV2.serialize(EitherOps.getOrThrowLeft(dustV2.deserialize(null, s))),
    ...singleWriterRewriters,
  },
};

/**
 * Restore a payload with the current code and serialize it again.
 *
 * @param writer - The variant doing the reading and writing.
 * @param surface - The persisted surface the payload belongs to.
 * @param serialized - The stored payload.
 * @returns What that writer writes for that payload.
 */
export const rewriteWithCurrentCode = (
  writer: Writer,
  surface: Surface,
  serialized: string,
): Promise<string> | string => rewriters[writer][surface](serialized);

/** A fixture origin is `facade-<version>` with an optional `-<variant>` suffix, e.g. `facade-4.1.0-deep`. */
const parseOrigin = (origin: string): { readonly version: readonly number[]; readonly variant: string } => {
  const match = /^facade-(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(origin);
  if (match === null) return { version: [0, 0, 0], variant: '' };
  return { version: [Number(match[1]), Number(match[2]), Number(match[3])], variant: match[4] ?? '' };
};

/** A baseline filename is `<surface>.json` or `<surface>-<variant>.json`. */
const variantOfBaseline = (surface: Surface, file: string): string =>
  file.replace(/\.json$/, '') === surface ? '' : file.replace(/\.json$/, '').slice(surface.length + 1);

/**
 * The frozen payload a baseline is captured from: the newest fixture for the same surface and variant.
 *
 * Capturing from real stored data rather than building a wallet keeps the capture deterministic and needs no chain, no
 * network and no devnet.
 *
 * @param surface - The persisted surface.
 * @param baselineFile - The baseline filename, e.g. `shielded-deep.json`.
 * @returns The newest frozen fixture matching that surface and variant.
 * @throws When no frozen fixture matches, which means the baseline has nothing to be captured from.
 */
export const sourceForBaseline = (surface: Surface, baselineFile: string): Fixture => {
  const wanted = variantOfBaseline(surface, baselineFile);
  const candidates = fixturesFor(surface)
    .filter((fixture) => parseOrigin(fixture.origin).variant === wanted)
    .sort((a, b) => {
      const [left, right] = [parseOrigin(a.origin).version, parseOrigin(b.origin).version];
      const at = left.findIndex((part, index) => part !== (right[index] ?? 0));
      return at === -1 ? 0 : (left[at] ?? 0) - (right[at] ?? 0);
    });
  const newest = candidates[candidates.length - 1];
  if (newest === undefined) {
    throw new Error(`no frozen fixture for surface '${surface}' variant '${wanted}' to capture a baseline from`);
  }
  return newest;
};
