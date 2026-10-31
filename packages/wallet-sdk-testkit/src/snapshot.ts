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
//
// Writing and reading the wallet snapshots `provideWallet` restores from. Internal to the testkit: `saveState` is
// re-exported from `wallet.ts`, the rest is not part of the public API.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as fsAsync from 'node:fs/promises';
import type { WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import type { WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import * as rx from 'rxjs';
import { logger } from './logger.js';
import { type DustSnapshotModel, snapshotPath } from './dust-sync.js';

/**
 * What a snapshot is taken from: the shielded and dust sub-wallets' serializers, and the dust sync model that produced
 * the dust state, which decides where that state may be restored.
 *
 * The unshielded wallet is not part of a snapshot: a restore starts it from its public key and it synchronizes from
 * genesis, so a serialized state of it would never be read.
 */
export type SnapshotSource = {
  readonly wallet: {
    readonly shielded: { serializeState(): Promise<string> };
    readonly dust: { serializeState(): Promise<string> };
  };
  readonly dustSyncModel: DustSnapshotModel;
};

/** The serialized states of one wallet, as {@link saveState} wrote them. */
export type WalletSnapshot = {
  readonly shielded: string;
  readonly dust: string;
};

const readIfExists = async (p: string): Promise<string | undefined> => {
  try {
    if (!existsSync(p)) return undefined;
    return await fsAsync.readFile(p, 'utf-8');
  } catch (err: unknown) {
    logger.error(`Failed to read ${p}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
};

const parseSnapshot = (raw: string): WalletSnapshot | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    if (!('shielded' in parsed && 'dust' in parsed)) return undefined;
    const { shielded, dust } = parsed;
    return typeof shielded === 'string' && typeof dust === 'string' ? { shielded, dust } : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Reads back the snapshot {@link saveState} wrote for `filename` under the given dust sync model.
 *
 * @param syncCacheDir The directory the snapshot was saved to.
 * @param filename The name it was saved under.
 * @param model The dust sync model the restored wallet will run.
 * @returns The snapshot, or `undefined` when there is no complete one to restore.
 */
export const readSnapshot = async (
  syncCacheDir: string,
  filename: string,
  model: DustSnapshotModel,
): Promise<WalletSnapshot | undefined> => {
  const path = snapshotPath(syncCacheDir, filename, model);
  const raw = await readIfExists(path);
  if (raw === undefined) return undefined;
  const snapshot = parseSnapshot(raw);
  if (snapshot === undefined) logger.warn(`Ignoring ${path}: not a complete wallet snapshot`);
  return snapshot;
};

/**
 * Serializes the shielded and dust sub-wallet states into one snapshot in `syncCacheDir`, keyed by `filename` and by
 * the dust sync model that produced the dust state.
 *
 * The snapshot is written whole under a temporary name and then renamed over the previous one, which replaces it in a
 * single step. A save that fails, or a process killed part-way through one, therefore leaves the previous snapshot as
 * it was — never a mix of two runs that the next run would restore as one wallet.
 *
 * Takes the whole source rather than the facade alone so the snapshot is always written to the namespace of the sync
 * model that produced it — a model and a facade passed separately could disagree.
 *
 * @param walletInit The wallet to snapshot, with the dust sync model it runs.
 * @param syncCacheDir The directory to save to; created if missing.
 * @param filename The name to save under.
 * @throws When a sub-wallet cannot be serialized or the snapshot cannot be written. A test whose state could not be
 *   saved must not pass as if it had been.
 */
export const saveState = async (walletInit: SnapshotSource, syncCacheDir: string, filename: string): Promise<void> => {
  const target = snapshotPath(syncCacheDir, filename, walletInit.dustSyncModel);
  logger.info(`Saving state to ${target}`);

  await fsAsync.mkdir(syncCacheDir, { recursive: true });
  const [shielded, dust] = await Promise.all([
    walletInit.wallet.shielded.serializeState(),
    walletInit.wallet.dust.serializeState(),
  ]);
  const snapshot: WalletSnapshot = { shielded, dust };

  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fsAsync.writeFile(temporary, JSON.stringify(snapshot), 'utf-8');
    await fsAsync.rename(temporary, target);
  } catch (err: unknown) {
    // Best effort: a temporary file that cannot be removed is never read, and the error rethrown here is the one that
    // matters.
    await fsAsync.rm(temporary, { force: true }).catch(() => undefined);
    throw err;
  }
  logger.info(`State written to ${target}`);
};

/**
 * How long a restored wallet may take to catch up before it is given up on. Well short of the quarter-hour the remote
 * suites allow a `beforeEach`, so a wedged restore still falls back to a from-scratch build inside that budget.
 */
const RESTORED_SYNC_TIMEOUT_MS = 10 * 60 * 1000;

/** Resolves `true` once the facade has caught up, or `false` if it has not within `timeoutMs`. */
const caughtUpWithin = async (wallet: Pick<WalletFacade, 'state'>, timeoutMs: number): Promise<boolean> =>
  await rx
    .firstValueFrom(
      wallet.state().pipe(
        rx.throttleTime(5000),
        rx.tap((state) => {
          const applyGap = state.unshielded.progress.highestTransactionId - state.unshielded.progress.appliedId;
          logger.info(`Wallet facade behind by ${applyGap}`);
        }),
        rx.filter((state) => state.unshielded.progress.isStrictlyComplete()),
        rx.timeout({ first: timeoutMs }),
      ),
    )
    .then(
      () => true,
      (error: unknown) => {
        if (error instanceof rx.TimeoutError) return false;
        throw error;
      },
    );

/**
 * Starts a facade assembled from a snapshot and checks that it synchronizes.
 *
 * @param facade The restored facade, not yet started.
 * @param seeds The seeds to start it with.
 * @param manualSync Whether to start it without background synchronization.
 * @param options How long to wait for the restored facade to catch up; ten minutes unless given.
 * @returns `true` when the restored facade synchronizes; `false`, with the facade stopped, when it cannot or does not
 *   catch up in time, so the caller builds from scratch instead.
 * @throws What starting or checking the facade threw, after stopping it, so a failed restore does not leave a facade
 *   synchronizing that nothing holds a reference to.
 */
export const startRestoredFacade = async (
  facade: Pick<WalletFacade, 'start' | 'stop' | 'state'>,
  seeds: WalletSeeds,
  manualSync: boolean,
  options: { readonly timeoutMs?: number } = {},
): Promise<boolean> => {
  const timeoutMs = options.timeoutMs ?? RESTORED_SYNC_TIMEOUT_MS;
  const synchronizes = async (): Promise<boolean> => {
    await facade.start(seeds, { manualSync });
    if (!(await caughtUpWithin(facade, timeoutMs))) {
      logger.warn(`Restored wallet did not catch up within ${timeoutMs}ms`);
      return false;
    }
    const restoredWalletState = await rx.firstValueFrom(facade.state());
    const applyGap =
      restoredWalletState.unshielded.progress.highestTransactionId - restoredWalletState.unshielded.progress.appliedId;
    logger.info(`Apply gap: ${applyGap}`);
    return applyGap >= 0;
  };

  const outcome = await synchronizes().then(
    (ok) => ({ ok }),
    (error: unknown) => ({ ok: false, error }),
  );
  if (!outcome.ok) {
    await facade.stop().catch((stopError: unknown) => {
      logger.error(
        `Failed to stop restored wallet: ${stopError instanceof Error ? stopError.message : String(stopError)}`,
      );
    });
  }
  if ('error' in outcome) throw outcome.error;
  if (!outcome.ok) logger.warn('Unable to sync restored wallet. Building wallet facade from scratch');
  return outcome.ok;
};
