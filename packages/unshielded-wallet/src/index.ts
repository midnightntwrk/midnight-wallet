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
export * from './UnshieldedWalletAPI.js';
export * from './SingleVariantUnshieldedWallet.js';
export * from './UnshieldedWallet.js';
// Exported under a wallet-qualified name rather than unqualified. The umbrella package re-exports all three wallets
// into one barrel, and each declares its own `UnsupportedSnapshotVersionError` — three classes of the same name with
// three different deterministic tags, one per wallet whose snapshot could not be read. Namespacing the third one keeps
// that barrel unambiguous without renaming the two that shipped before it.
export * as UnshieldedRestore from './Restore.js';
// Under the wallet's name rather than flat, for the same reason: the other wallets declare some of the same names,
// `TokenTransfer` among them.
export * as UnshieldedWalletTypes from './types/index.js';
export {
  type UnshieldedTransactionHistoryEntry,
  UnshieldedSectionSchema,
  mergeUnshieldedSections,
  type SignSegment,
} from './types/UnshieldedWalletTypes.js';
// The keystore's types, under their own names as they always were; `createKeystore` comes with the wallet itself.
export { PublicKey, type UnshieldedKeystore, type UnshieldedSecretKey } from './types/UnshieldedWalletTypes.js';
// The sync configuration under a wallet-qualified name, for the same reason as the restore errors above: the dust
// wallet exports a `DefaultSyncConfiguration` of its own, and the umbrella barrel would otherwise hold two.
export {
  type DefaultSyncConfiguration as DefaultUnshieldedSyncConfiguration,
  type NodeClientConnection,
  resolveNodeEndpoint,
} from './types/UnshieldedWalletTypes.js';
