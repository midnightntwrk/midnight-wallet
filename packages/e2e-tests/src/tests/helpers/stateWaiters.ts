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
import { type ShieldedWalletAPI } from '@midnight-ntwrk/wallet-sdk-shielded';
import { type UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { type WalletFacade, type WalletEntry } from '@midnight-ntwrk/wallet-sdk-facade';
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
          txFound: txInHistory !== undefined,
        };
      }),
      rx.filter(({ state, txFound }) => txFound && state.isSynced && state.dust.availableCoins.length > 0),
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
  let pollsSinceDump = 0;
  const txEntry = await rx.firstValueFrom(
    rx.merge(wallet.state().pipe(rx.filter((state) => state.isSynced)), rx.interval(500)).pipe(
      rx.mergeMap(async () => {
        const entry = await wallet.queryTxHistoryByHash(txHash);
        if (entry !== undefined && entry.status !== 'SUCCESS') {
          logger.info(
            `Waiting for tx ${txHash} in history: found, status=${entry.status}, sections=[${describeSections(entry)}] — non-SUCCESS, aborting wait`,
          );
          return entry;
        }
        const notReady = entry === undefined || !isReady(entry);
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
      rx.filter((entry): entry is WalletEntry => entry !== undefined && (entry.status !== 'SUCCESS' || isReady(entry))),
    ),
  );
  expect(txEntry).toBeDefined();
  expect(txEntry.hash).toBe(txHash);
  expect(txEntry.status).toBe('SUCCESS');
  return txEntry;
};
