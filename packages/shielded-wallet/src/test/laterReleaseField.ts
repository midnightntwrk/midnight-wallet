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
import { Schema } from 'effect';

/**
 * A top-level snapshot field stored by a later release, which this build does not declare. Nested, with an array and a
 * `null`, so a writer that re-encodes or partly copies it is caught as well as one that drops it.
 */
export const LATER_FIELD = { kept: ['exactly', 'as', 'written'], nested: { flag: true, nothing: null } };

const readJson = Schema.decodeUnknownSync(
  Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
);

/**
 * The snapshot a later release would have saved for the same wallet: `snapshot` with {@link LATER_FIELD} added at the
 * top level.
 *
 * @example
 *   const restored = serialization.deserialize(null, storedByLaterRelease(serialization.serialize(wallet)));
 */
export const storedByLaterRelease = (snapshot: string): string =>
  JSON.stringify({ ...readJson(snapshot), fieldFromALaterRelease: LATER_FIELD });

/**
 * What `snapshot` holds under the later release's field name: {@link LATER_FIELD} when it was carried, `undefined` when
 * it was dropped.
 *
 * @example
 *   expect(laterFieldIn(serialization.serialize(synced))).toStrictEqual(LATER_FIELD);
 */
export const laterFieldIn = (snapshot: string): unknown => readJson(snapshot)['fieldFromALaterRelease'];
