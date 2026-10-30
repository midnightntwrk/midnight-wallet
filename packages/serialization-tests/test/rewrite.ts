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
import {
  CoreWallet as ShieldedV1CoreWallet,
  Serialization as ShieldedV1Serialization,
} from '@midnightntwrk/wallet-sdk-shielded/v1';
import {
  CoreWallet as ShieldedV2CoreWallet,
  Serialization as ShieldedV2Serialization,
} from '@midnightntwrk/wallet-sdk-shielded/v2';
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
  'tx-history': (s) => InMemoryTransactionHistoryStorage.restore(s, WalletEntrySchema, mergeWalletEntries).serialize(),
  'pending-transactions': (s) =>
    PendingTransactions.serialize(
      EitherOps.getOrThrowLeft(PendingTransactions.deserialize(s, pendingTxTraits)),
      pendingTxTraits,
    ),
};

const shieldedV1 = ShieldedV1Serialization.makeDefaultV1SerializationCapability();
const shieldedV2 = ShieldedV2Serialization.makeDefaultV2SerializationCapability();
/**
 * A fixed instant for the unshielded readers. A booking stored without an expiry is dated a lifetime ahead of the
 * moment it is read back, so without a pinned clock the rewritten payload would differ on every run and the baseline
 * could never be matched.
 */
const frozenClock = { now: () => new Date('2026-03-01T12:00:00.000Z') };
const unshieldedV1 = UnshieldedV1Serialization.makeDefaultV1SerializationCapability({ clock: frozenClock });
const unshieldedV2 = UnshieldedV2Serialization.makeDefaultV2SerializationCapability({ clock: frozenClock });
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
export const variantOfBaseline = (surface: Surface, file: string): string =>
  file.replace(/\.json$/, '') === surface ? '' : file.replace(/\.json$/, '').slice(surface.length + 1);

/**
 * A baseline derived from a frozen fixture by one state step a running wallet takes, so that a shape only a running
 * wallet writes is frozen too.
 *
 * A plain rewrite records only what a stored payload already held. Some fields are written by the wallet after it has
 * been restored and nothing published has ever stored them, so no frozen fixture carries them and a rewrite can never
 * show them. The step is pure and runs at the pinned instant, so the capture is as deterministic as a rewrite.
 */
export type DerivedBaseline = Readonly<{
  surface: Surface;
  /** The baseline's own variant: the file is `<surface>-<variant>.json`. */
  variant: string;
  /** The frozen fixture variant the step starts from. */
  from: string;
  /** What the step does, recorded in the baseline file so a reader knows what it is looking at. */
  step: string;
}>;

/**
 * A booked coin's record — when sync first saw the booking, and its transaction's TTL — is written only once a sync
 * update has seen it, so no stored payload carries it before the wallet has run. The `pending` fixture holds the
 * booking itself; one sweep with no keys dates it without releasing it, which is exactly what a wallet writes after its
 * first update on a quiet chain.
 */
export const DERIVED_BASELINES: readonly DerivedBaseline[] = [
  {
    surface: 'shielded',
    variant: 'booked',
    from: 'pending',
    step: `one booking sweep with no keys at ${frozenClock.now().toISOString()}`,
  },
];

/** The derived baseline a filename names, if it names one. */
export const derivedBaselineFor = (surface: Surface, baselineFile: string): DerivedBaseline | undefined =>
  DERIVED_BASELINES.find(
    (derived) => derived.surface === surface && derived.variant === variantOfBaseline(surface, baselineFile),
  );

/** The one state step each derived baseline applies, per writer. Keyed by `<surface>-<variant>`. */
const derivedSteps: Record<Writer, Record<string, (serialized: string) => string>> = {
  v1: {
    'shielded-booked': (s) =>
      shieldedV1.serialize(
        ShieldedV1CoreWallet.expireBookings(
          EitherOps.getOrThrowLeft(shieldedV1.deserialize(null, s)),
          undefined,
          frozenClock.now(),
        ),
      ),
  },
  v2: {
    'shielded-booked': (s) =>
      shieldedV2.serialize(
        ShieldedV2CoreWallet.expireBookings(
          EitherOps.getOrThrowLeft(shieldedV2.deserialize(null, s)),
          undefined,
          frozenClock.now(),
        ),
      ),
  },
};

/**
 * What a writer records for a baseline file: a plain rewrite, or the derived step when the file names a derived
 * baseline.
 *
 * @param writer - The variant doing the reading and writing.
 * @param surface - The persisted surface the payload belongs to.
 * @param baselineFile - The baseline filename, e.g. `shielded-booked.json`.
 * @param serialized - The stored payload the baseline is captured from.
 * @returns What that writer writes for that baseline.
 */
export const captureWithCurrentCode = (
  writer: Writer,
  surface: Surface,
  baselineFile: string,
  serialized: string,
): Promise<string> | string => {
  const derived = derivedBaselineFor(surface, baselineFile);
  const step = derived === undefined ? undefined : derivedSteps[writer][`${surface}-${derived.variant}`];
  if (derived !== undefined && step === undefined) {
    throw new Error(`derived baseline '${surface}-${derived.variant}' has no step for writer '${writer}'`);
  }
  return step === undefined ? rewriteWithCurrentCode(writer, surface, serialized) : step(serialized);
};

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
  // A derived baseline is captured from the frozen fixture its step starts from.
  const wanted = derivedBaselineFor(surface, baselineFile)?.from ?? variantOfBaseline(surface, baselineFile);
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
