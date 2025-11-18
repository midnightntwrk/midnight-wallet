// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
export const merge =
  <K extends string | number | symbol, T>(combine: (a: T, b: T) => T) =>
  (records: Array<Record<K, T>>): Record<K, T> => {
    const result: Record<K, T> = {} as Record<K, T>;
    for (const record of records) {
      for (const key in record) {
        if (Object.hasOwn(result, key)) {
          result[key] = combine(result[key], record[key]);
        } else {
          result[key] = record[key];
        }
      }
    }
    return result;
  };

export const mergeWithAccumulator =
  <K extends string | number | symbol, T, S>(mempty: S, combine: (acc: S, b: T) => S) =>
  (records: Array<Record<K, T>>): Record<K, S> => {
    const result: Record<K, S> = {} as Record<K, S>;
    for (const record of records) {
      for (const key in record) {
        if (Object.hasOwn(result, key)) {
          result[key] = combine(result[key], record[key]);
        } else {
          result[key] = combine(mempty, record[key]);
        }
      }
    }
    return result;
  };
