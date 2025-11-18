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
export const safeParseJson = (serialized: string): unknown =>
  JSON.parse(serialized, (key, value) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    key === 'value' && typeof value === 'string' ? BigInt(value) : value,
  ) as unknown;

export const safeStringifyJson = (jsonObject: object): string =>
  JSON.stringify(jsonObject, (_, v) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    typeof v === 'bigint' ? v.toString() : v,
  );
