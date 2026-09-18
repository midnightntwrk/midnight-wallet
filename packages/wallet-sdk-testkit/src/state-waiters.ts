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
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import * as rx from 'rxjs';
import { expect } from 'vitest';
import type * as ledger from '@midnightntwrk/ledger-v9';
import { type ShieldedWalletAPI } from '@midnightntwrk/wallet-sdk-shielded';
import { type UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { type WalletFacade, type WalletEntry } from '@midnightntwrk/wallet-sdk-facade';
import { logger } from './logger.js';

/** Default dust-balance threshold to wait for: 7 * 10^14. */
export const DEFAULT_DUST_BALANCE_THRESHOLD = 7n * 10n ** 14n;

/** How long a condition must hold before a settling waiter accepts it. */
const DEFAULT_SETTLE_MS = 10_000;

/** How long a settling waiter waits for its condition before failing rather than running to the test timeout. */
const DEFAULT_SETTLE_TIMEOUT_MS = 180_000;

/**
 * Resolves with the wallet's current state once `predicate` has held continuously for `settleMs`.
 *
 * A settle window is needed because conditions like `pendingCoins.length === 0` are also the _resting_ state before a
 * transaction is submitted: a waiter that resolved on the first matching emission would hand back the stale
 * pre-transaction state.
 *
 * The window has to be applied to the predicate rather than to the source. Debouncing the source waits for the wallet
 * to stop emitting altogether, which never happens while a sub-wallet syncs in the background — a Dust wallet syncing
 * from projections emits about every 5 seconds indefinitely — so the predicate is never evaluated and the wait runs to
 * the test timeout while logging that its condition is already satisfied.
 *
 * `distinctUntilChanged` is load-bearing: without it, `switchMap` would cancel and restart the timer on every emission
 * and the timer would never elapse, reproducing the same starvation.
 *
 * The matching value is carried through the pipeline rather than re-read from `source` once the window elapses, because
 * `source` must only be subscribed once. The facade's `state()` replays its current value on subscribe, but a
 * sub-wallet's `state` does not: a second subscription there receives nothing until the next change, so on an
 * already-settled wallet it would never produce a value and the wait would hang. The state returned is therefore the
 * one from the moment the condition began to hold — callers that need the very latest should follow with their own
 * read.
 */
export const waitForStableState = <T>(
  source: rx.Observable<T>,
  predicate: (value: T) => boolean,
  description: string,
  settleMs: number = DEFAULT_SETTLE_MS,
  timeoutMs: number = DEFAULT_SETTLE_TIMEOUT_MS,
): Promise<T> =>
  rx.firstValueFrom(
    source.pipe(
      rx.map((value) => ({ value, holds: predicate(value) })),
      rx.distinctUntilChanged((a, b) => a.holds === b.holds),
      rx.switchMap(({ value, holds }) => (holds ? rx.timer(settleMs).pipe(rx.map(() => value)) : rx.NEVER)),
      rx.take(1),
      rx.timeout({
        first: timeoutMs,
        with: () =>
          rx.throwError(
            () =>
              new Error(
                `${description}: condition did not hold for ${settleMs}ms within ${timeoutMs}ms. The condition is genuinely unmet — this is not a missed observation window.`,
              ),
          ),
      }),
    ),
  );

export const waitForSyncUnshielded = (wallet: UnshieldedWallet) =>
  rx.firstValueFrom(
    wallet.state.pipe(
      rx.throttleTime(5_000),
      rx.tap((state) => {
        const applyGap = state.state.progress.highestTransactionId - state.state.progress.appliedId;
        logger.info(`Wallet behind by ${applyGap} indices`);
      }),
      rx.filter((state) => state.state.progress.isStrictlyComplete()),
    ),
  );

export const waitForFacadePending = (wallet: WalletFacade) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        const shieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Shielded wallet pending coins: ${shieldedPending}, waiting for pending coins...`);
        const unshieldedPending = state.unshielded.pendingCoins.length;
        logger.info(`Unshielded wallet pending coins: ${unshieldedPending}, waiting for pending coins...`);
      }),
      rx.filter((state) => state.shielded.pendingCoins.length > 0 || state.unshielded.pendingCoins.length > 0),
      // Pending coins are a transient state: if the tx confirms before it is observed here, the filter never matches and
      // the wait would otherwise hang until the whole-test timeout. Bound it so a missed window fails fast and legibly.
      rx.timeout({
        first: 120_000,
        with: () =>
          rx.throwError(
            () =>
              new Error(
                'waitForFacadePending: no pending coins observed within 120s — the pending window was likely missed (tx confirmed before it was observed) or the transaction was never submitted.',
              ),
          ),
      }),
    ),
  );

export const waitForFacadePendingClear = (wallet: WalletFacade) =>
  waitForStableState(
    wallet.state().pipe(
      rx.tap((state) => {
        logger.info(
          `Pending coins — shielded: ${state.shielded.pendingCoins.length}, unshielded: ${state.unshielded.pendingCoins.length}, dust: ${state.dust.pendingCoins.length}; waiting for all to clear...`,
        );
      }),
    ),
    (state) =>
      state.shielded.pendingCoins.length === 0 &&
      state.unshielded.pendingCoins.length === 0 &&
      state.dust.pendingCoins.length === 0,
    'waitForFacadePendingClear',
  );

export const waitForDustBalance = (wallet: WalletFacade, threshold: bigint = DEFAULT_DUST_BALANCE_THRESHOLD) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        const dustBalance = state.dust.balance(new Date());
        logger.info(`Dust balance: ${dustBalance}, waiting for dust balance > ${threshold}...`);
      }),
      rx.filter((state) => state.dust.balance(new Date()) > threshold),
    ),
  );

export const waitForFinalizedShieldedBalance = (wallet: ShieldedWalletAPI) =>
  waitForStableState(
    wallet.state.pipe(
      rx.tap((state) => {
        logger.info(`Wallet pending coins: ${state.pendingCoins.length}, waiting for pending coins cleared...`);
      }),
    ),
    (state) => state.pendingCoins.length === 0,
    'waitForFinalizedShieldedBalance',
  );

export const waitForUnshieldedCoinUpdate = (wallet: WalletFacade, initialNumAvailableCoins: number) =>
  waitForStableState(
    wallet.state().pipe(
      rx.tap((state) => {
        logger.info(
          `Unshielded available coins: ${state.unshielded.availableCoins.length}, waiting for more than ${initialNumAvailableCoins}...synced = ${state.isSynced}`,
        );
      }),
    ),
    (state) => state.isSynced && state.unshielded.availableCoins.length > initialNumAvailableCoins,
    'waitForUnshieldedCoinUpdate',
  );

export const waitForStateAfterDustRegistration = (wallet: WalletFacade, finalizedTx: ledger.FinalizedTransaction) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.mergeMap(async (state) => {
        const txInHistory = await wallet.queryTxHistoryByHash(finalizedTx.transactionHash());

        return {
          state,
          txConfirmed: txInHistory !== undefined && txInHistory.status === 'SUCCESS',
        };
      }),
      rx.filter(({ state, txConfirmed }) => txConfirmed && state.isSynced && state.dust.availableCoins.length > 0),
      rx.map(({ state }) => state),
    ),
  );

export const waitForRegisteredTokens = (wallet: WalletFacade) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((s) => {
        const registeredTokens = s.unshielded.availableCoins.filter(
          (coin) => coin.meta.registeredForDustGeneration === true,
        );
        logger.info(`registered tokens: ${registeredTokens.length}`);
      }),
      rx.filter(
        (s) => s.unshielded.availableCoins.filter((coin) => coin.meta.registeredForDustGeneration === true).length > 0,
      ),
    ),
  );

export const waitForTxInHistory = async (
  txHash: string,
  wallet: WalletFacade,
  ready?: (entry: WalletEntry) => boolean,
) => {
  const isReady = ready ?? (() => true);
  const describeSections = (e: WalletEntry): string =>
    (['shielded', 'unshielded', 'dust'] as const).filter((k) => e[k] !== undefined).join(',');
  const isTerminalFailure = (e: WalletEntry): boolean =>
    e.lifecycle.status === 'rejected' || e.status === 'FAILURE' || e.status === 'PARTIAL_SUCCESS';
  let pollsSinceDump = 0;
  const txEntry = await rx.firstValueFrom(
    rx.merge(wallet.state().pipe(rx.filter((state) => state.isSynced)), rx.interval(500)).pipe(
      rx.mergeMap(async () => {
        const entry = await wallet.queryTxHistoryByHash(txHash);
        if (entry !== undefined && isTerminalFailure(entry)) {
          logger.info(
            `Waiting for tx ${txHash} in history: found, status=${entry.status}, lifecycle=${entry.lifecycle.status}, sections=[${describeSections(entry)}] — terminal non-SUCCESS, aborting wait`,
          );
          return entry;
        }
        const notReady = entry === undefined || entry.status !== 'SUCCESS' || !isReady(entry);
        const needsDump = notReady && pollsSinceDump >= 20;
        if (entry === undefined) {
          logger.info(`Waiting for tx ${txHash} in history: not found yet`);
        } else {
          logger.info(`Waiting for tx ${txHash} in history: found, status=${entry.status}, ready=${isReady(entry)}`);
        }
        if (needsDump) {
          const all = await wallet.getAllFromTxHistory();
          const summary = all.map((e) => ({
            hash: e.hash,
            status: e.status,
            sections: describeSections(e),
            identifiers: e.identifiers ?? [],
          }));
          logger.info(`Storage snapshot (${all.length} entries): ${JSON.stringify(summary, null, 2)}`);
          pollsSinceDump = 0;
        } else {
          pollsSinceDump = notReady ? pollsSinceDump + 1 : 0;
        }
        return entry;
      }),
      rx.filter(
        (entry): entry is WalletEntry =>
          entry !== undefined && (isTerminalFailure(entry) || (entry.status === 'SUCCESS' && isReady(entry))),
      ),
    ),
  );
  expect(txEntry).toBeDefined();
  expect(txEntry.hash).toBe(txHash);
  expect(txEntry.status).toBe('SUCCESS');
  return txEntry;
};
