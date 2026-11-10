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
import {
  type FacadeState,
  type WalletFacade,
  type WalletEntry,
  type FinalizedWalletEntry,
  isPendingWalletEntry,
  isFinalizedWalletEntry,
} from '@midnightntwrk/wallet-sdk-facade';
// The settling-waiter primitive is single-sourced in the testkit so the two copies of these waiters cannot drift on the
// subtle part. See its JSDoc for why the settle window is applied to the predicate rather than to the source.
import { waitForStableState } from '@midnightntwrk/wallet-sdk-testkit';
import { logger } from '../logger.js';
import { carried } from './transactions.js';
import { type FinalizedTx } from '@midnightntwrk/wallet-sdk';

export const waitForSyncUnshielded = (wallet: UnshieldedWallet) =>
  rx.firstValueFrom(
    wallet.state.pipe(
      rx.throttleTime(5_000),
      rx.tap((state) => {
        const applyGap = state.progress.highestTransactionId - state.progress.appliedId;
        logger.info(`Wallet behind by ${applyGap} indices`);
      }),
      rx.filter((state) => state.progress.isStrictlyComplete()),
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

/** A deadline that says what was being waited for, rather than raising a bare `TimeoutError`. */
export const failingAfter = <T>(label: string, milliseconds: number): rx.MonoTypeOperatorFunction<T> =>
  rx.timeout({
    first: milliseconds,
    with: () => rx.throwError(() => new Error(`Timed out after ${milliseconds}ms waiting for ${label}`)),
  });

/** Caps a wait that would otherwise only be bounded by its test's timeout, naming it when it runs out. */
export const within = <T>(label: string, milliseconds: number, work: Promise<T>): Promise<T> =>
  rx.firstValueFrom(rx.from(work).pipe(failingAfter(label, milliseconds)));

/** The first state satisfying `settled`, or a failure naming what never happened. */
export const firstStateWhere = (
  label: string,
  wallet: WalletFacade,
  settled: (state: FacadeState) => boolean,
  milliseconds: number,
): Promise<FacadeState> =>
  rx.firstValueFrom(wallet.state().pipe(rx.filter(settled), failingAfter(label, milliseconds)));

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
  waitForStableState(
    wallet.state.pipe(
      rx.tap((state) => {
        const pending = state.pendingCoins.length;
        logger.info(`Wallet pending coins: ${pending}, waiting for pending coins cleared...`);
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
          `Unshielded available coins: ${state.unshielded.availableCoins.length}, waiting for more than ${initialNumAvailableCoins}... synced = ${state.isSynced}`,
        );
      }),
    ),
    (state) => state.isSynced && state.unshielded.availableCoins.length > initialNumAvailableCoins,
    'waitForUnshieldedCoinUpdate',
  );

export const waitForStateAfterDustRegistration = (wallet: WalletFacade, finalizedTx: FinalizedTx) =>
  rx.firstValueFrom(
    wallet.state().pipe(
      rx.mergeMap(async (state) => {
        const txInHistory = await wallet.queryTxHistoryByHash(
          carried<ledger.FinalizedTransaction>(finalizedTx).transactionHash(),
        );

        return {
          state,
          txFound: txInHistory !== undefined && isFinalizedWalletEntry(txInHistory),
        };
      }),
      rx.filter(({ state, txFound }) => txFound && state.isSynced && state.dust.availableCoins.length > 0),
      rx.map(({ state }) => state),
    ),
  );

/**
 * Every intent hash the ledger can stamp on a coin `finalizedTx` creates.
 *
 * An output's intent hash is taken with the segment that applies its offer: a guaranteed offer applies in segment 0 and
 * a fallible offer in its intent's own segment, so each intent contributes both `intentHash(0)` and
 * `intentHash(segment)`.
 *
 * @param finalizedTx - The transaction whose outputs are looked for.
 * @returns The intent hashes its outputs can carry.
 */
export const outputIntentHashesOf = (finalizedTx: FinalizedTx): readonly string[] =>
  [...(carried<ledger.FinalizedTransaction>(finalizedTx).intents?.entries() ?? [])].flatMap(([segment, intent]) => [
    intent.intentHash(0),
    intent.intentHash(segment),
  ]);

/**
 * Waits for a dust deregistration transaction to finalize successfully and for the wallet to hold the Night outputs it
 * created.
 *
 * A synced facade does not mean every wallet inside it has applied the transaction, so the wait is on the effect
 * itself. History is written by a fan-out beside sync rather than by sync itself, so the entry is polled with
 * {@link waitForTxInHistory}; the outputs are then awaited on the state stream. Both waits are bounded and fail with an
 * error naming what was missing.
 *
 * @param wallet - The wallet that submitted the deregistration.
 * @param finalizedTx - The submitted deregistration transaction.
 * @param unshieldedTokenRaw - The raw token type of Night.
 * @returns The first wallet state holding an available Night coin created by `finalizedTx`.
 * @throws If the history entry does not finalize with `SUCCESS`, or either wait runs out of time.
 */
export const waitForStateAfterDustDeregistration = async (
  wallet: WalletFacade,
  finalizedTx: FinalizedTx,
  unshieldedTokenRaw: ledger.RawTokenType,
) => {
  const txHash = carried<ledger.FinalizedTransaction>(finalizedTx).transactionHash();
  await waitForTxInHistory(txHash, wallet, { timeoutMs: 60_000 });

  const outputIntentHashes = outputIntentHashesOf(finalizedTx);
  const ownOutputs = (state: FacadeState) =>
    state.unshielded.availableCoins.filter(
      (coin) => coin.utxo.type === unshieldedTokenRaw && outputIntentHashes.includes(coin.utxo.intentHash),
    );

  return rx.firstValueFrom(
    wallet.state().pipe(
      rx.tap((state) => {
        logger.info(`Night outputs of dust deregistration ${txHash} held: ${ownOutputs(state).length}`);
      }),
      rx.filter((state) => ownOutputs(state).length > 0),
      rx.timeout({
        first: 60_000,
        with: () =>
          rx.throwError(
            () => new Error(`No Night output of dust deregistration ${txHash} became available within 60 s`),
          ),
      }),
    ),
  );
};

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
  /**
   * Optional bound on the wait, in milliseconds. When set, a target not reached in time fails with an error naming the
   * hash and the target, instead of running into the test timeout. Defaults to no bound.
   */
  timeoutMs?: number;
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
  const polled = rx.merge(wallet.state().pipe(rx.filter((state) => state.isSynced)), rx.interval(500)).pipe(
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
  );
  const txEntry = await rx.firstValueFrom(
    options.timeoutMs === undefined
      ? polled
      : polled.pipe(
          rx.timeout({
            first: options.timeoutMs,
            with: () =>
              rx.throwError(
                () => new Error(`Tx ${txHash} did not reach ${until} in history within ${options.timeoutMs} ms`),
              ),
          }),
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

/**
 * Polls a wallet's transaction history until at least one finalized entry satisfies `matches`, and returns every
 * finalized entry that does.
 *
 * Use this when the transaction of interest has no hash to hand — a freshly built wallet rediscovers history by
 * syncing, so a test that asserts on what it found cannot name the entry it is waiting for. Reaching a synced state is
 * not enough on its own: history entries are written by a fan-out that runs alongside the sync rather than as part of
 * it, so a wallet can report itself synced with its history still empty.
 *
 * @param wallet - The wallet whose transaction history is polled.
 * @param matches - Predicate selecting the entries of interest, applied only to finalized entries.
 * @param description - Included in the progress logs, so a stalled wait says what it was waiting for.
 */
export async function waitForFinalizedTxHistoryEntries(
  wallet: WalletFacade,
  matches: (entry: WalletEntry) => boolean,
  description: string,
): Promise<readonly FinalizedWalletEntry[]> {
  return await rx.firstValueFrom(
    rx.merge(wallet.state().pipe(rx.filter((state) => state.isSynced)), rx.interval(500)).pipe(
      rx.mergeMap(async () => {
        const all = await wallet.getAllFromTxHistory();
        const found = all.filter(isFinalizedWalletEntry).filter(matches);
        logger.info(
          `Waiting for ${description} in tx history: ${found.length} match of ${all.length} entries ` +
            `(${all.filter(isPendingWalletEntry).length} still pending)`,
        );
        return found.length > 0 ? found : undefined;
      }),
      rx.filter((found): found is FinalizedWalletEntry[] => found !== undefined),
    ),
  );
}
