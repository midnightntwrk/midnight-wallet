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

/**
 * The data the shielded wallet's API speaks, in types the SDK owns.
 *
 * @remarks
 *   Everything here is plain data that both ledger versions report identically, so both variants are stated in these
 *   types and neither ledger version has to be named to read what a shielded wallet emits. Each variant's tree
 *   re-exports them under the names it always had. Kept apart from `ShieldedWalletAPI.ts`, which the package exports
 *   flat: these it exports under the wallet's name, as `ShieldedWalletTypes`, because several of them —
 *   `TokenTransfer`, `IndexerClientConnection` — are also another wallet's.
 */
import { TransactionHistoryStorage, type TokenType } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ShieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { Array as EArray, Schema } from 'effect';

/** A shielded coin's nullifier, as hexadecimal. */
export type Nullifier = string;

/** A shielded coin's commitment, as hexadecimal. */
export type CoinCommitment = string;

/** A shielded coin: the token type it is in, the randomness that keeps it unique, and its value. */
export type ShieldedCoinInfo = {
  type: TokenType;
  nonce: string;
  value: bigint;
};

/** A shielded coin together with its index in the commitment tree, which spending it needs. */
export type QualifiedShieldedCoinInfo = {
  type: TokenType;
  nonce: string;
  value: bigint;
  mt_index: bigint;
};

export type AvailableCoin = {
  coin: QualifiedShieldedCoinInfo;
  commitment: CoinCommitment;
  nullifier: Nullifier;
};

export type PendingCoin = {
  coin: ShieldedCoinInfo;
  ttl: Date | undefined;
  commitment: CoinCommitment;
  nullifier: Nullifier;
};

export type Coin = AvailableCoin | PendingCoin;

/**
 * A coin booked for a transaction that has not settled, so it is in the wallet but not spendable.
 *
 * @remarks
 *   Not to be confused with {@link PendingCoin}, which is a coin the wallet expects to receive. `reservedSince` is when
 *   sync first saw the booking and `releasableAfter` when the wallet will release it if nothing settles it first; both
 *   are `undefined` until sync has seen it.
 */
export type ReservedCoin = {
  coin: QualifiedShieldedCoinInfo;
  nullifier: Nullifier;
  reservedSince: Date | undefined;
  releasableAfter: Date | undefined;
};

export type Balances = Record<TokenType, bigint>;

export interface TokenTransfer {
  readonly amount: bigint;
  readonly type: TokenType;
  readonly receiverAddress: ShieldedAddress;
}

export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
  keepAlive?: number;
  /** Cap on the in-flight event queue between the WebSocket push and the apply loop. Default: 10000. */
  bufferSize?: number;
  /** In-flight count at which the disposed WS subscription is reopened. Default: 100. */
  resumeThreshold?: number;
};

export type BatchUpdatesConfig = {
  /**
   * Maximum number of events to collect into a single batch before emitting.
   *
   * @default 10
   */
  readonly size?: number;
  /**
   * Maximum time in milliseconds to wait for a full batch before emitting a partial one. Controls the `groupedWithin`
   * timeout — lower values mean more responsive (but smaller) batches when events arrive slowly.
   *
   * @default 1
   */
  readonly timeout?: number;
  /**
   * Minimum delay in milliseconds injected between consecutive batches. Prevents the sync stream from saturating
   * downstream consumers when many events are available at once. Set to 0 to disable spacing entirely.
   *
   * @default 4
   */
  readonly spacing?: number;
};

export const QualifiedShieldedCoinInfoSchema = Schema.Struct({
  type: Schema.String,
  nonce: Schema.String,
  value: Schema.BigInt,
  mtIndex: Schema.BigInt,
});

export const ShieldedSectionSchema = Schema.Struct({
  receivedCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
  spentCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
});

type ShieldedSection = Schema.Schema.Type<typeof ShieldedSectionSchema>;

const coinEquals = Schema.equivalence(QualifiedShieldedCoinInfoSchema);

/**
 * Merges two records of one transaction's shielded section, so that a coin either of them records appears once.
 *
 * @param existing The section already stored.
 * @param incoming The section being written.
 * @returns The coins received and spent according to either.
 */
export const mergeShieldedSections = (existing: ShieldedSection, incoming: ShieldedSection): ShieldedSection => ({
  receivedCoins: EArray.unionWith(existing.receivedCoins, incoming.receivedCoins, coinEquals),
  spentCoins: EArray.unionWith(existing.spentCoins, incoming.spentCoins, coinEquals),
});

/**
 * Shielded entry schema. Extends the common entry shape with an optional `shielded` section. Tightening — required
 * `shielded` plus required `protocolVersion`/`status` — happens at the writer-input type, not on the stored shape.
 */
export const ShieldedTransactionHistoryEntrySchema = TransactionHistoryStorage.extendEntrySchema({
  shielded: Schema.optional(ShieldedSectionSchema),
});

export type ShieldedTransactionHistoryEntry = Schema.Schema.Type<typeof ShieldedTransactionHistoryEntrySchema>;

export type ShieldedHistoryStorage =
  TransactionHistoryStorage.TransactionHistoryReader<TransactionHistoryStorage.TransactionHistoryEntryWithHash> &
    TransactionHistoryStorage.TransactionHistoryWriter<ShieldedTransactionHistoryEntry>;
