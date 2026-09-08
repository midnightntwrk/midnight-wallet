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
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import * as ProtocolVersion from '../ProtocolVersion.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);

const range = (start: bigint, end: bigint): ProtocolVersion.ProtocolVersion.Range =>
  ProtocolVersion.makeRange(version(start), version(end));

/** The registry the routing use cases have: one value per protocol era, the last era open-ended. */
const eras = (): ProtocolVersion.Registry<string> =>
  ProtocolVersion.makeRegistryFromActivations([
    { sinceVersion: ProtocolVersion.MinSupportedVersion, value: 'v8' },
    { sinceVersion: version(100n), value: 'v9' },
  ]).pipe(Either.getOrThrow);

describe('ProtocolVersion.Registry', () => {
  describe('makeRegistry', () => {
    it('accepts ascending, non-overlapping ranges and keeps them in registration order', () => {
      const registry = ProtocolVersion.makeRegistry([
        { range: range(0n, 100n), value: 'first' },
        { range: range(100n, 200n), value: 'second' },
      ]);

      expect(registry).toStrictEqual(
        Either.right({
          entries: [
            { range: range(0n, 100n), value: 'first' },
            { range: range(100n, 200n), value: 'second' },
          ],
        }),
      );
    });

    it('accepts gaps between ranges', () => {
      const registry = ProtocolVersion.makeRegistry([
        { range: range(0n, 10n), value: 'first' },
        { range: range(50n, 60n), value: 'second' },
      ]);

      expect(Either.isRight(registry)).toBe(true);
    });

    it('accepts no entries at all', () => {
      expect(ProtocolVersion.makeRegistry<string>([])).toStrictEqual(Either.right(ProtocolVersion.emptyRegistry));
    });

    it('rejects overlapping ranges, naming the boundary versions that overlap', () => {
      const registry = ProtocolVersion.makeRegistry([
        { range: range(0n, 100n), value: 'first' },
        { range: range(99n, 200n), value: 'second' },
      ]);

      const error = registry.pipe(Either.flip, Either.getOrThrow);

      expect(error._tag).toBe('@midnightntwrk/wallet-sdk-abstractions/ProtocolVersion/RegistryError');
      expect(error.versions).toStrictEqual([version(100n), version(99n)]);
    });

    it('rejects ranges given out of ascending order', () => {
      const registry = ProtocolVersion.makeRegistry([
        { range: range(100n, 200n), value: 'second' },
        { range: range(0n, 100n), value: 'first' },
      ]);

      const error = registry.pipe(Either.flip, Either.getOrThrow);

      expect(error.versions).toStrictEqual([version(200n), version(0n)]);
    });
  });

  describe('makeRegistryFromActivations', () => {
    it('derives half-open ranges, running the last activation up to the maximum supported version', () => {
      const registry = ProtocolVersion.makeRegistryFromActivations([
        { sinceVersion: ProtocolVersion.MinSupportedVersion, value: 'v8' },
        { sinceVersion: version(100n), value: 'v9' },
      ]);

      expect(registry).toStrictEqual(
        Either.right({
          entries: [
            { range: ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, version(100n)), value: 'v8' },
            { range: ProtocolVersion.makeRange(version(100n), ProtocolVersion.MaxSupportedVersion), value: 'v9' },
          ],
        }),
      );
    });

    it('gives a single activation the whole range above it', () => {
      const registry = ProtocolVersion.makeRegistryFromActivations([{ sinceVersion: version(7n), value: 'only' }]);

      expect(registry).toStrictEqual(
        Either.right({
          entries: [
            { range: ProtocolVersion.makeRange(version(7n), ProtocolVersion.MaxSupportedVersion), value: 'only' },
          ],
        }),
      );
    });

    it('accepts no activations at all', () => {
      expect(ProtocolVersion.makeRegistryFromActivations<string>([])).toStrictEqual(
        Either.right(ProtocolVersion.emptyRegistry),
      );
    });

    it('rejects two activations at the same version', () => {
      const registry = ProtocolVersion.makeRegistryFromActivations([
        { sinceVersion: version(100n), value: 'first' },
        { sinceVersion: version(100n), value: 'second' },
      ]);

      const error = registry.pipe(Either.flip, Either.getOrThrow);

      expect(error._tag).toBe('@midnightntwrk/wallet-sdk-abstractions/ProtocolVersion/RegistryError');
      expect(error.versions).toStrictEqual([version(100n), version(100n)]);
    });

    it('rejects activations given out of ascending order', () => {
      const registry = ProtocolVersion.makeRegistryFromActivations([
        { sinceVersion: version(100n), value: 'second' },
        { sinceVersion: version(50n), value: 'first' },
      ]);

      const error = registry.pipe(Either.flip, Either.getOrThrow);

      expect(error.versions).toStrictEqual([version(100n), version(50n)]);
    });

    it('rejects an activation at the maximum supported version, which no range can follow', () => {
      const registry = ProtocolVersion.makeRegistryFromActivations([
        { sinceVersion: ProtocolVersion.MaxSupportedVersion, value: 'unreachable' },
      ]);

      const error = registry.pipe(Either.flip, Either.getOrThrow);

      expect(error.versions).toStrictEqual([ProtocolVersion.MaxSupportedVersion]);
    });
  });

  describe('select', () => {
    it('returns the value whose range contains the version', () => {
      expect(ProtocolVersion.select(eras(), version(0n))).toStrictEqual(Option.some('v8'));
      expect(ProtocolVersion.select(eras(), version(99n))).toStrictEqual(Option.some('v8'));
      expect(ProtocolVersion.select(eras(), version(100n))).toStrictEqual(Option.some('v9'));
      expect(ProtocolVersion.select(eras(), version(1_000n))).toStrictEqual(Option.some('v9'));
    });

    it('includes the start of a range and excludes its end', () => {
      const registry = ProtocolVersion.makeRegistry([{ range: range(10n, 20n), value: 'middle' }]).pipe(
        Either.getOrThrow,
      );

      expect(ProtocolVersion.select(registry, version(9n))).toStrictEqual(Option.none());
      expect(ProtocolVersion.select(registry, version(10n))).toStrictEqual(Option.some('middle'));
      expect(ProtocolVersion.select(registry, version(19n))).toStrictEqual(Option.some('middle'));
      expect(ProtocolVersion.select(registry, version(20n))).toStrictEqual(Option.none());
    });

    it('returns none inside a gap between ranges', () => {
      const registry = ProtocolVersion.makeRegistry([
        { range: range(0n, 10n), value: 'first' },
        { range: range(50n, 60n), value: 'second' },
      ]).pipe(Either.getOrThrow);

      expect(ProtocolVersion.select(registry, version(25n))).toStrictEqual(Option.none());
    });

    it('returns none for an empty registry', () => {
      expect(ProtocolVersion.select(ProtocolVersion.emptyRegistry, version(0n))).toStrictEqual(Option.none());
    });

    it('never throws for a version no entry covers', () => {
      expect(() => ProtocolVersion.select(eras(), ProtocolVersion.MaxSupportedVersion)).not.toThrow();
      expect(ProtocolVersion.select(eras(), ProtocolVersion.MaxSupportedVersion)).toStrictEqual(Option.none());
    });
  });

  describe('selectEntry', () => {
    it('returns the whole entry, so callers can read the range they matched', () => {
      expect(ProtocolVersion.selectEntry(eras(), version(120n))).toStrictEqual(
        Option.some({
          range: ProtocolVersion.makeRange(version(100n), ProtocolVersion.MaxSupportedVersion),
          value: 'v9',
        }),
      );
    });

    it('returns none when no entry covers the version', () => {
      expect(ProtocolVersion.selectEntry(ProtocolVersion.emptyRegistry, version(0n))).toStrictEqual(Option.none());
    });
  });
});
