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
 * The indexer's post-fork replay of a dust timeline — test scaffolding only.
 *
 * @remarks
 *   After the hard fork the indexer replays the timeline: the history a wallet already synced is served again, this time
 *   as events of the new ledger version, numbered onwards from whatever event id it had reached. That is why a migrated
 *   dust wallet starts with no dust and simply syncs — it re-discovers its own dust from the replay rather than
 *   carrying it across.
 *
 *   **What the replay is here.** A ledger `Event` cannot cross a version boundary as-is: ledger-v8 frames its events
 *   `midnight:event[v9]:` and ledger-v9 frames them `midnight:event[v14]:`, and each refuses the other's header
 *   outright (`expected header tag 'midnight:event[v14]:', got 'midnight:event[v9]:'`). What ledger-v8 and ledger-v9
 *   _do_ agree on is everything after that header: the payload of a `dustInitialUtxo` event is byte-identical between
 *   them. So the replay is modelled by re-framing each pre-fork event under the post-fork header — the same event,
 *   re-emitted by the new ledger version, which is precisely what an indexer replay is.
 *
 *   That agreement is not assumed. `forkSimulation.test.ts` opens by asserting it directly: a re-framed event applied by
 *   ledger-v9 produces the same dust — same nonces, same backing Night, same values, same Merkle indices, same tree
 *   roots — as the original applied by ledger-v8. If a future ledger release changes the dust event encoding, that
 *   assertion fails and this whole model is retired loudly rather than quietly modelling something false.
 *
 *   This is where dust does better than the shielded proof: shielded re-mints equivalent coins to reproduce equivalent
 *   commitments, and needs the real v8-to-v9 state translation to close the fidelity gap. Dust replays the same event
 *   bytes, so the pre-fork and post-fork wallets are directly comparable without any translation at all.
 *
 *   **Two modelling choices are load-bearing and deliberate.**
 *
 *   - **The replay continues the pre-fork event numbering.** The indexer numbers its replay onwards from the id it had
 *       reached when the fork happened, never from zero, so the replay opens just past the boundary and a migrated
 *       wallet parks its cursor there and meets it head-on. Numbering the replay from one instead, while the migration
 *       parks, would put most of it behind the cursor and the wallet would come back holding only the tail of its own
 *       history. (The mirror image is not symmetric — a cursor behind the replay reads all of it anyway — so what
 *       separates parking from resetting is the migrated cursor itself, asserted where the migration produced it.)
 *   - **Every replayed event carries the post-fork protocol version.** Tagging the whole replay inside the new variant's
 *       activation range is what keeps any of it from being deferred straight back to a variant that has already handed
 *       over.
 */

import { Event as PreForkEvent } from '@midnight-ntwrk/ledger-v8';
import { Event as PostForkEvent } from '@midnightntwrk/ledger-v9';
import { type WalletSyncSubscription as PreForkItem } from '../v1/Sync.js';
import { type WalletSyncSubscription as PostForkItem } from '../v2/SyncSchema.js';

/** The serialization header ledger-v8 frames an `Event` with. */
const preForkHeader = 'midnight:event[v9]:';

/** The serialization header ledger-v9 frames an `Event` with. */
const postForkHeader = 'midnight:event[v14]:';

const headerBytes = (header: string): readonly number[] => [...header].map((character) => character.charCodeAt(0));

const hasHeader = (bytes: Uint8Array, header: readonly number[]): boolean =>
  header.every((byte, index) => bytes[index] === byte);

/**
 * Re-frames a pre-fork event's bytes under the post-fork ledger's header.
 *
 * @remarks
 *   The whole of the modelling. Only the header is rewritten; the payload is passed through untouched, which is what
 *   makes the replayed event the _same_ event rather than an equivalent one.
 * @param bytes A serialized ledger-v8 `Event`.
 * @returns The same event, framed for ledger-v9.
 * @throws Error if `bytes` is not a ledger-v8 event — a harness that re-framed the wrong thing must not look like a
 *   fork that went wrong.
 */
export const reframeAsPostFork = (bytes: Uint8Array): Uint8Array => {
  const from = headerBytes(preForkHeader);
  if (!hasHeader(bytes, from)) {
    throw new Error(`Not a ledger-v8 event: expected the header ${preForkHeader}`);
  }
  return Uint8Array.from([...headerBytes(postForkHeader), ...bytes.subarray(from.length)]);
};

/**
 * One event on the indexer's wire: its id, its bytes, and the protocol version it was reported under.
 *
 * @remarks
 *   Bytes rather than an `Event` instance, because `replayEventsWithChanges` takes ownership of the events it is handed
 *   (wasm-bindgen moves them) — so every delivery deserializes its own instance. Held in the pre-fork encoding
 *   throughout: whether an item is read as a pre-fork or a post-fork event is decided by which variant is being fed,
 *   which is the fork itself expressed as a type.
 */
export type TimelineEvent = Readonly<{
  /** The indexer's event id. One id space, shared by the pre-fork timeline and the replay that continues it. */
  id: number;
  /** The event as ledger-v8 serialized it. */
  bytes: Uint8Array;
  /** The protocol version the indexer reported this event under. */
  protocolVersion: number;
}>;

/**
 * Numbers a run of events from `firstId`, all reported at `protocolVersion`.
 *
 * @param eventBytes Serialized pre-fork events, in chain order.
 * @param firstId The id of the first event — 1 for the pre-fork timeline, the boundary id for the replay continuing it.
 * @param protocolVersion The version every one of these events is reported under.
 * @returns The numbered run, in the order given.
 */
export const numberedFrom = (
  eventBytes: readonly Uint8Array[],
  firstId: number,
  protocolVersion: number,
): readonly TimelineEvent[] => eventBytes.map((bytes, offset) => ({ id: firstId + offset, bytes, protocolVersion }));

/**
 * The tip an item is reported against: the last id in the batch it arrives in.
 *
 * @remarks
 *   The indexer reports its own highest id alongside each event, and every batch this harness delivers runs to the tip
 *   the source has reached — the pre-fork timeline up to the boundary event, the replay up to its last event — so the
 *   batch's own last id _is_ that tip.
 */
const tipOf = (batch: readonly TimelineEvent[]): number => batch.at(-1)?.id ?? 0;

/** The batch as the pre-fork variant's subscription sees it: events decoded by ledger-v8. */
export const asPreForkItems = (batch: readonly TimelineEvent[]): PreForkItem[] => {
  const maxId = tipOf(batch);
  return batch.map((event) => ({
    id: event.id,
    maxId,
    protocolVersion: event.protocolVersion,
    raw: PreForkEvent.deserialize(event.bytes),
  }));
};

/** The batch as the post-fork variant's subscription sees it: the same events, re-framed and decoded by ledger-v9. */
export const asPostForkItems = (batch: readonly TimelineEvent[]): PostForkItem[] => {
  const maxId = tipOf(batch);
  return batch.map((event) => ({
    id: event.id,
    maxId,
    protocolVersion: event.protocolVersion,
    raw: PostForkEvent.deserialize(reframeAsPostFork(event.bytes)),
  }));
};
