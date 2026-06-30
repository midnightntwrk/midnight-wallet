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
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { type ShieldedWalletAPI } from '@midnightntwrk/wallet-sdk-shielded';
import { type UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import {
  type WalletFacade,
  type WalletEntry,
  isPendingWalletEntry,
  isFinalizedWalletEntry,
} from '@midnightntwrk/wallet-sdk-facade';
import { logger } from '../logger.js';

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
    ),
  );

export const waitForFacadePendingClear = (wallet: WalletFacade) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        const shieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Shielded wallet pending coins: ${shieldedPending}, waiting for pending coins to clear...`);
        const unshieldedPending = state.unshielded.pendingCoins.length;
        logger.info(`Unshielded wallet pending coins: ${unshieldedPending}, waiting for pending coins to clear...`);
        const dustPending = state.dust.pendingCoins.length;
        logger.info(`Dust wallet pending coins: ${dustPending}, waiting for pending coins to clear...`);
      }),
      rx.debounceTime(10_000),
      rx.filter(
        (state) =>
          state.shielded.pendingCoins.length == 0 &&
          state.unshielded.pendingCoins.length == 0 &&
          state.dust.pendingCoins.length == 0,
      ),
    ),
  );

export const waitForDustBalance = (wallet: WalletFacade) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        const dustBalance = state.dust.balance(new Date());
        logger.info(`Dust balance: ${dustBalance}, waiting for dust balance > 7 * 10^14...`);
      }),
      rx.filter((state) => state.dust.balance(new Date()) > 7n * 10n ** 14n),
    ),
  );

export const waitForFinalizedShieldedBalance = (wallet: ShieldedWalletAPI) =>
  rx.firstValueFrom(
    wallet.state.pipe(
      rx.tap((state) => {
        const pending = state.pendingCoins.length;
        logger.info(`Wallet pending coins: ${pending}, waiting for pending coins cleared...`);
      }),
      rx.filter((state) => state.pendingCoins.length === 0),
    ),
  );

export const waitForUnshieldedCoinUpdate = (wallet: WalletFacade, initialNumAvailableCoins: number) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        const currentNumAvailableCoins = state.unshielded.availableCoins.length;
        logger.info(
          `Unshielded available coins: ${currentNumAvailableCoins}, waiting for more than ${initialNumAvailableCoins}...`,
        );
      }),
      rx.debounceTime(10_000),
      rx.filter((s) => s.isSynced),
      rx.filter((s) => s.unshielded.availableCoins.length > initialNumAvailableCoins),
    ),
  );

export const waitForStateAfterDustRegistration = (wallet: WalletFacade, finalizedTx: ledger.FinalizedTransaction) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.mergeMap(async (state) => {
        const txInHistory = await wallet.queryTxHistoryByHash(finalizedTx.transactionHash());

        return {
          state,
          txFound: txInHistory !== undefined && isFinalizedWalletEntry(txInHistory),
        };
      }),
      rx.filter(({ state, txFound }) => txFound && state.isSynced && state.dust.availableCoins.length > 0),
      rx.map(({ state }) => state),
    ),
  );

/** Waits for a dust deregistration transaction to settle and the consolidated Night output to re-sync. */
export const waitForStateAfterDustDeregistration = (
  wallet: WalletFacade,
  finalizedTx: ledger.FinalizedTransaction,
  unshieldedTokenRaw: ledger.RawTokenType,
) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.mergeMap(async (state) => {
        const txInHistory = await wallet.queryTxHistoryByHash(finalizedTx.transactionHash());

        return {
          state,
          txFound: txInHistory !== undefined,
        };
      }),
      rx.filter(
        ({ state, txFound }) =>
          txFound && state.isSynced && state.unshielded.balances[unshieldedTokenRaw] !== undefined,
      ),
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

/**
 * The lifecycle stage {@link waitForTxInHistory} can wait for. Derived from the entry's `lifecycle.status` so it stays
 * in lock-step with the schema's lifecycle union rather than duplicating the literals.
 */
export type TxLifecycleTarget = WalletEntry['lifecycle']['status'];

/** Options controlling what {@link waitForTxInHistory} waits for. */
export interface WaitForTxInHistoryOptions {
  /**
   * Which lifecycle stage to wait for. Defaults to `'finalized'`.
   *
   * - `'finalized'` — the tx has been confirmed on chain. **Additionally** requires the on-chain outcome `status ===
   *   'SUCCESS'`, i.e. a _successful_ finalization. A finalized-but-failed tx (`FAILURE` / `PARTIAL_SUCCESS`) counts as
   *   a terminal mismatch and is surfaced (so the assertion fails) rather than waited on. This is the default because
   *   every transfer test wants a successful confirmation.
   * - `'rejected'` — the tx was reverted or dropped and recorded as rejected (e.g. after `revertTransaction`). Rejected
   *   entries carry no on-chain `status`.
   * - `'pending'` — the tx has been submitted and recorded as pending, but not yet finalized.
   */
  until?: TxLifecycleTarget;
  /**
   * Optional refinement applied _on top of_ the `until` lifecycle match: the wait only resolves once the lifecycle
   * target is reached **and** `ready(entry)` returns `true`. Defaults to `() => true` (no extra refinement). Typical
   * use is to wait until a particular wallet section has populated, e.g. `ready: (e) => e.shielded !== undefined`. The
   * predicate receives the full {@link WalletEntry}, so it can inspect any field (sections, `status`, `identifiers`,
   * …).
   */
  ready?: (entry: WalletEntry) => boolean;
}

/**
 * Polls a wallet's transaction history until the entry for `txHash` reaches a target lifecycle stage.
 *
 * By default (`until` omitted → `'finalized'`) it waits for a _successful_ finalization — lifecycle `finalized` **and**
 * on-chain `status === 'SUCCESS'`. Pass `until: 'rejected'` or `until: 'pending'` to await those stages instead
 * (neither carries a `SUCCESS` status). The optional {@link WaitForTxInHistoryOptions.ready} predicate refines the match
 * further.
 *
 * Always returns the matching {@link WalletEntry} — the resolved entry is guaranteed (by the assertion below) to be in
 * the requested lifecycle, so callers can read its sections/`status` directly without re-narrowing.
 *
 * The wait resolves as soon as the target lifecycle is reached and `ready` passes. If the tx instead settles into a
 * _terminal_ lifecycle that isn't the requested one — e.g. waiting for `finalized` but the tx is `rejected`, or it
 * finalized with a non-`SUCCESS` outcome — the wait aborts early and the returned entry fails the caller's assertion
 * with a descriptive message rather than hanging until timeout.
 *
 * @param txHash - The transaction hash to look up in history.
 * @param wallet - The wallet whose transaction history is polled.
 * @param options - See {@link WaitForTxInHistoryOptions}. Omit it (or omit `until`) to wait for a successful
 *   finalization.
 */
export async function waitForTxInHistory(
  txHash: string,
  wallet: WalletFacade,
  options: WaitForTxInHistoryOptions = {},
): Promise<WalletEntry> {
  const until = options.until ?? 'finalized';
  const isReady = options.ready ?? (() => true);

  // A finalized target additionally demands a SUCCESS outcome; rejected/pending match on lifecycle alone.
  const matchesTarget = (entry: WalletEntry): boolean =>
    until === 'finalized'
      ? isFinalizedWalletEntry(entry) && entry.status === 'SUCCESS'
      : until === 'rejected'
        ? entry.lifecycle.status === 'rejected'
        : isPendingWalletEntry(entry);

  // A lifecycle is *terminal* once it can no longer change (finalized or rejected); pending is transient.
  const isTerminal = (entry: WalletEntry): boolean =>
    isFinalizedWalletEntry(entry) || entry.lifecycle.status === 'rejected';

  const describeSections = (e: WalletEntry): string =>
    (['shielded', 'unshielded', 'dust'] as const).filter((k) => e[k] !== undefined).join(',');

  let pollsSinceDump = 0;
  const txEntry = await rx.firstValueFrom(
    rx.merge(wallet.state().pipe(rx.filter((state) => state.isSynced)), rx.interval(500)).pipe(
      rx.mergeMap(async () => {
        const entry = await wallet.queryTxHistoryByHash(txHash);
        // Resolve when we hit the requested lifecycle (+ ready). Fast-fail when the tx settles into a different
        // terminal lifecycle — it will never reach the target, so surface it instead of waiting for the timeout.
        const reached = entry !== undefined && matchesTarget(entry) && isReady(entry);
        const terminalMismatch = entry !== undefined && !matchesTarget(entry) && isTerminal(entry);
        const done = reached || terminalMismatch;

        if (entry === undefined) {
          logger.info(`Waiting for tx ${txHash} (until=${until}): not found yet`);
        } else {
          logger.info(
            `Waiting for tx ${txHash} (until=${until}): lifecycle=${entry.lifecycle.status}, status=${entry.status}, sections=[${describeSections(entry)}], done=${done}`,
          );
        }

        if (!done && pollsSinceDump >= 20) {
          const all = await wallet.getAllFromTxHistory();
          const summary = all.map((e) => ({
            hash: e.hash,
            lifecycle: e.lifecycle.status,
            status: e.status ?? '(none)',
            sections: describeSections(e) || '(none)',
            identifiers: e.identifiers,
          }));
          logger.info(`Storage snapshot (${all.length} entries): ${JSON.stringify(summary, null, 2)}`);
          pollsSinceDump = 0;
        } else {
          pollsSinceDump = done ? 0 : pollsSinceDump + 1;
        }

        return done ? entry : undefined;
      }),
      rx.filter((entry): entry is WalletEntry => entry !== undefined),
    ),
  );

  expect(txEntry).toBeDefined();
  expect(txEntry.hash).toBe(txHash);
  if (!matchesTarget(txEntry)) {
    throw new Error(
      `Expected ${until} entry for ${txHash}, got lifecycle '${txEntry.lifecycle.status}'` +
        (isFinalizedWalletEntry(txEntry) ? ` (status '${txEntry.status}')` : ''),
    );
  }
  return txEntry;
}
