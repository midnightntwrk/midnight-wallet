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
// The facade keeps one lifecycle record per transaction it balances, finalizes or submits, in
// `facade.transactionLifecycleService`. An application persists it beside the wallet snapshots and the transaction
// history: `serializeState()` on the service gives a string to save, and the `transactionLifecycleService` factory in
// the facade's init parameters restores it on the next start. A balanced transaction is saved with its proofs erased,
// so the string holds no secret key. The saved store is versioned: one written by an earlier SDK opens, upgraded on the
// way in, and one this SDK cannot read is refused rather than opened as an empty store. Nothing here touches the network.
import {
  DefaultForkSchedule,
  type InitParams,
  lifecycleTransactionTraits,
  type DefaultConfiguration,
} from '@midnightntwrk/wallet-sdk/facade';
import { TransactionLifecycleServiceImpl } from '@midnightntwrk/wallet-sdk/capabilities/transactionLifecycle';

// The facade builds its service like this, with the traits it reads its own records with, at the chain's v9 fork.
const configuration = {
  indexerClientConnection: { indexerHttpUrl: 'http://indexer.invalid' },
  forks: DefaultForkSchedule,
};
const facadesService = await TransactionLifecycleServiceImpl.init({
  txTraits: lifecycleTransactionTraits(configuration.forks.v9),
  configuration,
});

// #region persist
// In an application this is `facade.transactionLifecycleService.serializeState()`. Save the string wherever the wallet
// snapshots are saved.
const savedLifecycle = await facadesService.serializeState();
console.log('saved format', (JSON.parse(savedLifecycle) as { version: string }).version);
// #endregion persist

// #region restore
// On the next start, hand the saved string back through the factory. It is given the facade's own configuration and
// clock, so the restored service reads with the facade's traits and stamps its records by the facade's time.
export const restoreLifecycle =
  (stored: string): InitParams<DefaultConfiguration>['transactionLifecycleService'] =>
  (config, { clock }) =>
    TransactionLifecycleServiceImpl.restore(stored, lifecycleTransactionTraits(config.forks.v9), config, clock);

const restored = await TransactionLifecycleServiceImpl.restore(
  savedLifecycle,
  lifecycleTransactionTraits(configuration.forks.v9),
  configuration,
);
console.log('restored records', (await restored.serializeState()) === savedLifecycle);
// #endregion restore

// #region newer
// A store saved by a newer SDK, in a format this one does not know, is refused, naming the version it found.
const savedByANewerSdk = JSON.stringify({ version: 'v9', records: [] });
await TransactionLifecycleServiceImpl.restore(
  savedByANewerSdk,
  lifecycleTransactionTraits(configuration.forks.v9),
  configuration,
).then(
  () => console.log('opened'),
  (error: unknown) => console.log('refused', String(error).includes('"v9"')),
);
// #endregion newer
