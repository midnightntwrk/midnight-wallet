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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fsAsync from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWalletLifecycle, type LifecycleWallet } from '../lifecycle.js';
import { snapshotPath } from '../dust-sync.js';
import { readSnapshot } from '../snapshot.js';

/** A hand-written wallet that records what was done to it, in order, into a log shared across wallets. */
const fakeWallet = (
  label: string,
  log: string[],
  behaviour: { readonly serializeFails?: boolean; readonly stopFails?: boolean } = {},
): LifecycleWallet => {
  const serialize = (part: string) => () => {
    log.push(`serialize ${label}`);
    return behaviour.serializeFails
      ? Promise.reject(new Error(`${label} cannot serialize`))
      : Promise.resolve(`${label}-${part}`);
  };
  return {
    wallet: {
      shielded: { serializeState: serialize('shielded') },
      dust: { serializeState: () => Promise.resolve(`${label}-dust`) },
      stop: () => {
        log.push(`stop ${label}`);
        return behaviour.stopFails ? Promise.reject(new Error(`${label} cannot stop`)) : Promise.resolve();
      },
    },
    dustSyncModel: 'events',
  };
};

/** The errors a rejected release reported, whether it threw one error or an `AggregateError` of several. */
const reportedErrors = async (release: Promise<void>): Promise<string[]> => {
  const error: unknown = await release.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return [];
  const errors = error instanceof AggregateError ? error.errors : [error];
  return errors.map((e: unknown) => (e instanceof Error ? e.message : String(e)));
};

describe('createWalletLifecycle', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'testkit-lifecycle-'));
  });

  afterEach(async () => {
    await fsAsync.rm(directory, { recursive: true, force: true });
  });

  it('should save every wallet before stopping any, because saving serializes live state', async () => {
    const log: string[] = [];
    const lifecycle = createWalletLifecycle();
    await lifecycle.adopt(Promise.resolve(fakeWallet('one', log)), 'one.state');
    await lifecycle.adopt(Promise.resolve(fakeWallet('two', log)), 'two.state');

    await lifecycle.release({ syncCacheDir: directory, persist: true });

    const lastSave = Math.max(log.indexOf('serialize one'), log.indexOf('serialize two'));
    const firstStop = Math.min(log.indexOf('stop one'), log.indexOf('stop two'));
    expect(lastSave).toBeGreaterThanOrEqual(0);
    expect(lastSave).toBeLessThan(firstStop);
  });

  it.each([
    ['persist is false', { syncCacheDir: 'set below', persist: false }],
    ['the directory is empty', { syncCacheDir: '', persist: true }],
    ['the directory is unset', { syncCacheDir: undefined, persist: true }],
  ])('should stop without saving when %s', async (_case, options) => {
    const log: string[] = [];
    const lifecycle = createWalletLifecycle();
    await lifecycle.adopt(Promise.resolve(fakeWallet('one', log)), 'one.state');

    await lifecycle.release({
      ...options,
      syncCacheDir: options.syncCacheDir === 'set below' ? directory : options.syncCacheDir,
    });

    expect(log).toEqual(['stop one']);
  });

  it('should remove the snapshot of each wallet it would have saved when the test did not pass, so a snapshot that may be why the test failed is not restored by the next run', async () => {
    const log: string[] = [];
    const earlier = createWalletLifecycle();
    await earlier.adopt(Promise.resolve(fakeWallet('one', log)), 'one.state');
    await earlier.adopt(Promise.resolve(fakeWallet('other', log)), 'other.state');
    await earlier.release({ syncCacheDir: directory, persist: true });

    const failing = createWalletLifecycle();
    await failing.adopt(Promise.resolve(fakeWallet('one', log)), 'one.state');
    await failing.adopt(Promise.resolve(fakeWallet('unsaved', log)));
    await failing.release({ syncCacheDir: directory, persist: false });

    await expect(readSnapshot(directory, 'one.state', 'events')).resolves.toBeUndefined();
    await expect(readSnapshot(directory, 'other.state', 'events')).resolves.toBeDefined();
  });

  it('should keep the snapshots of a failed test that vitest will run again, so the retry restores them instead of syncing from scratch', async () => {
    const log: string[] = [];
    const earlier = createWalletLifecycle();
    await earlier.adopt(Promise.resolve(fakeWallet('one', log)), 'one.state');
    await earlier.release({ syncCacheDir: directory, persist: true });

    const retried = createWalletLifecycle();
    await retried.adopt(Promise.resolve(fakeWallet('one', log)), 'one.state');
    await retried.release({ syncCacheDir: directory, persist: false, willRetry: true });

    await expect(readSnapshot(directory, 'one.state', 'events')).resolves.toBeDefined();
  });

  it('should remove the snapshot of a wallet still starting when the test did not pass, so a restore that wedged the setup is not offered to the next run', async () => {
    const log: string[] = [];
    const earlier = createWalletLifecycle();
    await earlier.adopt(Promise.resolve(fakeWallet('stuck', log)), 'stuck.state');
    await earlier.release({ syncCacheDir: directory, persist: true });

    const failing = createWalletLifecycle();
    const { promise: starting, resolve: finishStarting } = Promise.withResolvers<LifecycleWallet>();
    const adopted = failing.adopt(starting, 'stuck.state');
    await failing.release({ syncCacheDir: directory, persist: false });
    finishStarting(fakeWallet('stuck', log));

    await expect(adopted).rejects.toThrow();
    await expect(readSnapshot(directory, 'stuck.state', 'events')).resolves.toBeUndefined();
  });

  it('should report a snapshot it could not delete, so a snapshot a test failed on is not uploaded again unnoticed', async () => {
    const log: string[] = [];
    const undeletable = snapshotPath(directory, 'one.state', 'events');
    await fsAsync.mkdir(undeletable, { recursive: true });
    await fsAsync.writeFile(path.join(undeletable, 'content'), '');
    const failing = createWalletLifecycle();
    await failing.adopt(Promise.resolve(fakeWallet('one', log)), 'one.state');

    const errors = await reportedErrors(failing.release({ syncCacheDir: directory, persist: false }));

    expect(errors).toHaveLength(1);
    expect(log).toContain('stop one');
  });

  it('should keep the previous snapshot when a passing test cannot save over it, so a failed save loses nothing', async () => {
    const log: string[] = [];
    const earlier = createWalletLifecycle();
    await earlier.adopt(Promise.resolve(fakeWallet('one', log)), 'one.state');
    await earlier.release({ syncCacheDir: directory, persist: true });

    const failingSave = createWalletLifecycle();
    await failingSave.adopt(Promise.resolve(fakeWallet('one', log, { serializeFails: true })), 'one.state');
    const errors = await reportedErrors(failingSave.release({ syncCacheDir: directory, persist: true }));

    expect(errors).toEqual(['one cannot serialize']);
    await expect(readSnapshot(directory, 'one.state', 'events')).resolves.toBeDefined();
  });

  it('should still save and stop the other wallet when saving one fails, and report the failure', async () => {
    const log: string[] = [];
    const lifecycle = createWalletLifecycle();
    await lifecycle.adopt(Promise.resolve(fakeWallet('one', log, { serializeFails: true })), 'one.state');
    await lifecycle.adopt(Promise.resolve(fakeWallet('two', log)), 'two.state');

    const errors = await reportedErrors(lifecycle.release({ syncCacheDir: directory, persist: true }));

    expect(errors).toEqual(['one cannot serialize']);
    await expect(readSnapshot(directory, 'two.state', 'events')).resolves.toBeDefined();
    expect(log).toEqual(expect.arrayContaining(['stop one', 'stop two']));
  });

  it('should stop the other wallet when one fails to stop, and report every failure, so no wallet is left running without a trace', async () => {
    const log: string[] = [];
    const lifecycle = createWalletLifecycle();
    await lifecycle.adopt(
      Promise.resolve(fakeWallet('one', log, { serializeFails: true, stopFails: true })),
      'one.state',
    );
    await lifecycle.adopt(Promise.resolve(fakeWallet('two', log)), 'two.state');

    const errors = await reportedErrors(lifecycle.release({ syncCacheDir: directory, persist: true }));

    expect(errors).toEqual(expect.arrayContaining(['one cannot serialize', 'one cannot stop']));
    expect(errors).toHaveLength(2);
    expect(log).toContain('stop two');
  });

  it('should stop a wallet that finishes starting after release has run, so a timed-out beforeEach does not leave it syncing into the next test', async () => {
    const log: string[] = [];
    const lifecycle = createWalletLifecycle();
    const { promise: starting, resolve: finishStarting } = Promise.withResolvers<LifecycleWallet>();
    const adopted = lifecycle.adopt(starting, 'late.state');

    await lifecycle.release({ syncCacheDir: directory, persist: true });
    finishStarting(fakeWallet('late', log));

    await expect(adopted).rejects.toThrow();
    expect(log).toEqual(['stop late']);
    await expect(readSnapshot(directory, 'late.state', 'events')).resolves.toBeUndefined();
  });

  it('should report both that a wallet arrived after teardown and that it then failed to stop, so the cause is not lost', async () => {
    const log: string[] = [];
    const lifecycle = createWalletLifecycle();
    const { promise: starting, resolve: finishStarting } = Promise.withResolvers<LifecycleWallet>();
    const adopted = lifecycle.adopt(starting, 'late.state');

    await lifecycle.release({ syncCacheDir: directory, persist: true });
    finishStarting(fakeWallet('late', log, { stopFails: true }));

    const error: unknown = await adopted.then(
      () => undefined,
      (e: unknown) => e,
    );
    const messages = [
      error instanceof Error ? error.message : String(error),
      ...(error instanceof AggregateError ? error.errors : []).map((e: unknown) =>
        e instanceof Error ? e.message : String(e),
      ),
    ].join('\n');
    expect(messages).toMatch(/after its test was torn down/);
    expect(messages).toContain('late cannot stop');
  });

  it('should stop each wallet once when released twice', async () => {
    const log: string[] = [];
    const lifecycle = createWalletLifecycle();
    await lifecycle.adopt(Promise.resolve(fakeWallet('one', log)), 'one.state');

    await lifecycle.release({ syncCacheDir: directory, persist: true });
    await lifecycle.release({ syncCacheDir: directory, persist: true });

    expect(log.filter((entry) => entry === 'stop one')).toHaveLength(1);
    expect(log.filter((entry) => entry === 'serialize one')).toHaveLength(1);
  });
});
