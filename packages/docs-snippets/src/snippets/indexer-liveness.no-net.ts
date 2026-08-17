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

// Reading the indexer liveness verdict.
//
// The wallet compares the indexer's latest block against the node's highest finalized block — after establishing,
// once, that both report the same genesis block. Three verdicts make the wallet report itself incomplete: `Behind`,
// which proves its view is stale; `Unknown`, which lasts the few seconds until the first comparison lands; and
// `WrongNetwork`, which proves the two endpoints are on different chains. The rest are informational. All seven are
// readable at any time, so an application can explain a wallet's state to a user rather than only showing a boolean.

import {
  type DefaultConfiguration,
  type FacadeState,
  IndexerLiveness,
  type UnshieldedWalletState,
  type WalletFacade,
} from '@midnightntwrk/wallet-sdk';
import { Duration } from 'effect';
import { firstValueFrom, type Subscription } from 'rxjs';

// Turning a verdict into something worth showing a user. `$match` is exhaustive: adding a verdict later fails to compile
// here until it is handled.
const describeLiveness = IndexerLiveness.match({
  InSync: ({ indexerHeight, finalizedHeight }) =>
    `Indexer is up to date (block ${indexerHeight} against a finalized head of ${finalizedHeight}).`,

  Behind: ({ lag, indexerHeight, finalizedHeight }) =>
    `Indexer is ${lag} block(s) behind the chain (${indexerHeight} against ${finalizedHeight}). ` +
    `Balances may be missing recent funds.`,

  Ahead: ({ overshoot, indexerHeight, finalizedHeight }) =>
    `Indexer reports block ${indexerHeight}, which is ${overshoot} ahead of this node's finalized head ` +
    `(${finalizedHeight}). Check that both point at the same network.`,

  // The detail worth surfacing: how long the check has been failing, and what failed most recently. Either side may be
  // the one that failed — the node read, the indexer read, or the whole poll timing out — and `lastError` says which.
  Unavailable: ({ consecutiveFailures, lastError }) =>
    `The indexer cannot be verified right now — ${consecutiveFailures} poll(s) have failed. ` +
    `Most recently: ${lastError}`,

  Skipped: ({ reason }) => `Indexer is not being verified against a node (${reason}).`,

  Unknown: () => 'Indexer has not been verified against a node yet.',

  // The loudest verdict: the two endpoints disagree about the genesis block, so one of them points at another chain
  // and every balance shown is suspect. This pins until the configuration is fixed — it cannot heal on its own.
  WrongNetwork: ({ indexerGenesisHash, nodeGenesisHash }) =>
    `The indexer and the node are on different networks (indexer genesis ${indexerGenesisHash}, ` +
    `node genesis ${nodeGenesisHash}). Check the configured endpoints.`,
});

// The verdict lives on the wallet's state, so it is read wherever that state is read.
export const describeUnshieldedLiveness = (state: UnshieldedWalletState): string =>
  describeLiveness(state.progress.indexerLiveness);

// The facade's state carries the same unshielded progress.
export const describeFacadeLiveness = (state: FacadeState): string =>
  describeLiveness(state.unshielded.progress.indexerLiveness);

// Both are observables, so in practice a verdict is read as the state changes.
export const reportLivenessChanges = (facade: WalletFacade): Subscription =>
  facade.state().subscribe((state) => {
    console.log(describeFacadeLiveness(state));
  });

// Or read once, for a one-off check.
export const currentLiveness = async (facade: WalletFacade): Promise<string> =>
  describeFacadeLiveness(await firstValueFrom(facade.state()));

// Acting on one case in particular, rather than describing them all.
export const failedAttemptsToReachNode = (state: UnshieldedWalletState): number | undefined => {
  const verdict = state.progress.indexerLiveness;

  return IndexerLiveness.isUnavailable(verdict) ? verdict.consecutiveFailures : undefined;
};

// A wallet can report itself complete while still having something worth saying about the indexer: only `Behind`,
// `Unknown` and `WrongNetwork` affect the boolean — plus the connection flag, which is a different statement again. `isConnected: false`
// means this wallet's own subscription to the indexer is down (it clears when the sync stream fails and returns with
// the next update), whereas a `Behind` verdict means the subscription works but the indexer itself is stale. An
// application that shows both can tell a user "reconnecting" apart from "your balance may be out of date".
export const summarise = (
  state: UnshieldedWalletState,
): { complete: boolean; subscribed: boolean; liveness: string } => ({
  complete: state.progress.isStrictlyComplete(),
  subscribed: state.progress.isConnected,
  liveness: describeLiveness(state.progress.indexerLiveness),
});

// Tuning the check. Both fields are optional, and the defaults — 10 blocks of tolerance either way, polled every 30
// seconds — allow about a minute of staleness at Midnight's 6-second blocks, re-checked every five blocks or so. Add
// these to the configuration passed to `WalletFacade.init`.
export const tunedLiveness: Pick<DefaultConfiguration, 'livenessConfiguration' | 'livenessPollInterval'> = {
  livenessConfiguration: {
    // The staleness allowance: how out-of-date a view the application is willing to treat as current. This is what
    // decides `Behind`, and so what decides whether the wallet reports itself complete.
    maxBehindBlocks: 4n,

    // Read skew only. The indexer ingests finalized blocks, so it cannot legitimately lead the node's finalized head by
    // more than the gap between the two reads accounts for — keep this small, or a fabricated height passes as `InSync`
    // instead of `Ahead`.
    maxAheadBlocks: 2n,

    // How long one comparison may run before it is abandoned and reported as `Unavailable` (default 20 seconds).
    // Polls run one at a time, so without this bound a read that hangs would stop the check silently.
    pollTimeout: Duration.seconds(10),
  },

  // Accepts a `Duration`, a millisecond count, or a string such as '15 seconds'. Each poll costs one request to the
  // indexer and one to the node, so this trades load against how quickly a stalled indexer is noticed. Polls do not
  // overlap, and a node read is abandoned after ten seconds, so an interval below that buys nothing.
  livenessPollInterval: '15 seconds',
};

// Naming the verification node explicitly. Without this, the check reads the node already named by `relayURL` for
// transaction submission — the right default, since both point at the same chain. Set it to verify against a node you
// trust more than the submission relay, or on a wallet built without submission configuration, which has no `relayURL`
// to borrow. A wallet naming neither runs no check and reports `Skipped`.
export const ownVerificationNode: Pick<DefaultConfiguration, 'nodeClientConnection'> = {
  nodeClientConnection: { nodeURL: 'wss://my-own-node.example:9944' },
};

// Gating start-up on a synchronized wallet, without hanging silently.
//
// `waitForSyncedState()` resolves only when the wallet is genuinely synchronized: it does not reject and does not time
// out, so against an indexer that is behind the chain — or a dropped subscription — it simply waits. That is the
// point, but a start-up gate should say *why* it is still waiting. The diagnosis is on the progress, not in the
// promise: race the wait against a deadline of your own, and on expiry read the verdict and the connection flag.
export const syncedStateOrExplanation = async (
  facade: WalletFacade,
  deadlineMillis: number,
): Promise<FacadeState | string> => {
  const deadline = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), deadlineMillis));
  const synced = await Promise.race([facade.waitForSyncedState(), deadline]);

  if (synced !== undefined) {
    return synced;
  }

  const { progress } = (await firstValueFrom(facade.state())).unshielded;
  return progress.isConnected
    ? describeLiveness(progress.indexerLiveness)
    : 'The indexer subscription is down; the wallet is reconnecting.';
};
