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
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import * as VersionChangeType from '../VersionChangeType.js';

describe('VersionChangeType', () => {
  it('should create a version change with a given protocol version number', () => {
    const change = VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) });

    expect(VersionChangeType.isVersion(change)).toBeTruthy();
    expect(VersionChangeType.isNext(change)).toBeFalsy();
  });

  it('should create a version change for the next protocol version number', () => {
    const change = VersionChangeType.Next();

    expect(VersionChangeType.isNext(change)).toBeTruthy();
    expect(VersionChangeType.isVersion(change)).toBeFalsy();
  });

  it('should match version change for given protocol number', () => {
    const expectedVersion = 100n;
    const change = VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(expectedVersion) });

    expect(
      VersionChangeType.match(change, {
        Version: (vc) => vc.version,
        Next: () => 0n,
      }),
    ).toEqual(expectedVersion);
  });
});
