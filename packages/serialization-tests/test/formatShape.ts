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
//
// Structural signature of a parsed persisted payload. Two payloads written by the SAME schema
// collapse to the SAME shape regardless of their values, array lengths, or dynamic map keys — so
// the format-drift gate can compare "what the current code writes" against "what the newest train
// froze" without tripping on nonces, hashes, or coin counts. It intentionally does NOT look inside
// opaque strings (the ledger state hex blob is just `string`): that is the ledger's own
// serialization, guarded separately by the generator's MPT canonicity sweep.
//
// What a shape DOES capture: presence/absence of a field, its nesting, and its leaf JS type. So a
// migration that adds a required field (e.g. `lifecycle`), drops one, renames one, or changes a
// value's encoding (string-bigint -> number) changes the shape and trips the gate.
//
// ponytail: struct-vs-map is a heuristic (all keys hex/numeric => map). A record whose real schema
// keys are all-hex would be misread as a map; none of the wallet schemas do that. Upgrade path if
// that ever bites: pass an explicit set of map-typed paths instead of sniffing keys.

const MAP_KEY = /^([0-9a-fA-F]{16,}|\d+)$/;

const mergeShapes = (shapes: readonly string[]): string => {
  const unique = [...new Set(shapes)].sort();
  return unique.length <= 1 ? (unique[0] ?? 'never') : unique.join('|');
};

/** Reduce a JSON-parsed value to a canonical structural signature string. */
export const formatShape = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'array<>' : `array<${mergeShapes(value.map(formatShape))}>`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const keys = entries.map(([key]) => key);
    // A dynamic-key map (coin hashes keyed by commitment, etc.) carries data in its keys, not
    // schema — collapse it to the merged shape of its values so different keys/counts match.
    if (keys.length > 0 && keys.every((key) => MAP_KEY.test(key))) {
      return `map<${mergeShapes(entries.map(([, v]) => formatShape(v)))}>`;
    }
    return `{${entries
      .map(([key, v]) => [key, formatShape(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, shape]) => `${key}:${shape}`)
      .join(',')}}`;
  }
  return typeof value; // 'string' | 'number' | 'boolean' | 'bigint'
};
