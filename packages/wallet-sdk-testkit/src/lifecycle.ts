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
import { logger } from './logger.js';
import { saveState, type SnapshotSource } from './snapshot.js';

/** A started wallet the lifecycle can snapshot and stop. */
export type LifecycleWallet = SnapshotSource & { readonly wallet: { stop(): Promise<void> } };

type Adopted = { readonly wallet: LifecycleWallet; readonly filename: string | undefined };

/** Options for {@link WalletLifecycle.release}. */
export type ReleaseOptions = {
  /** Directory to snapshot the wallets to before stopping them. Nothing is saved when it is unset or empty. */
  readonly syncCacheDir?: string | undefined;
  /** Whether the wallets are in a position worth saving; pass `shouldPersistState(context)`. */
  readonly persist: boolean;
};

/**
 * The wallets one test's `beforeEach` started, for its `afterEach` to save and stop.
 *
 * @example
 *   ```ts
 *   let lifecycle: WalletLifecycle;
 *   beforeEach(async () => {
 *     const own = createWalletLifecycle();
 *     lifecycle = own;
 *     wallet = await own.adopt(provideWallet(env, { seed, syncCacheDir, filename }), filename);
 *   });
 *   afterEach((context) => lifecycle.release({ syncCacheDir, persist: shouldPersistState(context) }));
 *   ```;
 */
export type WalletLifecycle = {
  /**
   * Records a wallet as started, so that {@link WalletLifecycle.release} stops it.
   *
   * @param started The wallet being started.
   * @param filename The name to snapshot it under on release; omit for a wallet that is never saved.
   * @returns The started wallet.
   */
  readonly adopt: <T extends LifecycleWallet>(started: Promise<T>, filename?: string) => Promise<T>;
  /**
   * Saves every adopted wallet that has a filename, when asked to, then stops every adopted wallet.
   *
   * @param options Where to save, and whether to.
   */
  readonly release: (options: ReleaseOptions) => Promise<void>;
};

/**
 * Creates the lifecycle for one test's wallets. Create a new one in each `beforeEach`.
 *
 * Release saves every wallet before stopping any, since saving serializes live state, and settles every save and every
 * stop before reporting: one wallet that cannot be saved or stopped never leaves another running. Each failure is
 * reported — one as itself, several as an `AggregateError`.
 *
 * A wallet that finishes starting only after release has run — a `beforeEach` that outlived its timeout, which vitest
 * does not cancel — is stopped as it arrives instead of synchronizing into the next test.
 *
 * @returns An empty lifecycle.
 */
export const createWalletLifecycle = (): WalletLifecycle => {
  // Mutable by design: this is test teardown bookkeeping, filled in as `beforeEach` starts wallets and closed by
  // `afterEach`.
  const state: { adopted: readonly Adopted[]; released: boolean } = { adopted: [], released: false };

  const adopt = async <T extends LifecycleWallet>(started: Promise<T>, filename?: string): Promise<T> => {
    const wallet = await started;
    if (state.released) {
      const tornDown = 'The wallet finished starting after its test was torn down';
      const stopError: unknown = await wallet.wallet.stop().then(
        () => undefined,
        (error: unknown) => error ?? new Error('stop() rejected without a reason'),
      );
      if (stopError !== undefined) throw new AggregateError([stopError], `${tornDown}, and stopping it failed`);
      throw new Error(`${tornDown}, so it has been stopped`);
    }
    state.adopted = [...state.adopted, { wallet, filename }];
    return wallet;
  };

  const release = async ({ syncCacheDir, persist }: ReleaseOptions): Promise<void> => {
    // Only the first release saves and stops: a second would stop wallets that are already stopped.
    if (state.released) return;
    state.released = true;
    const { adopted } = state;

    const saves =
      syncCacheDir && persist
        ? await Promise.allSettled(
            adopted.flatMap(({ wallet, filename }) =>
              filename === undefined ? [] : [saveState(wallet, syncCacheDir, filename)],
            ),
          )
        : [];
    const stops = await Promise.allSettled(adopted.map(({ wallet }) => wallet.wallet.stop()));
    logger.info('Wallets stopped');

    const failures = [...saves, ...stops].flatMap((result): unknown[] =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `${failures.length} wallet saves or stops failed`);
  };

  return { adopt, release };
};
