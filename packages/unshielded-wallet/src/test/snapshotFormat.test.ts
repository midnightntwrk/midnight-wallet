// The one upgrade step an unshielded snapshot has: `v1`, whose verifying key is a bare string, to `v2`, whose key
// says which scheme it is for. A pure function on the decoded JSON, run before any schema — so it is tested as one,
// with no wallet, no ledger and no keys involved.
//
// Tier: unit.
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_FORMAT_VERSIONS,
  V1_SNAPSHOT_FORMAT_VERSION,
  upgradeSnapshotV1ToV2,
} from '../SnapshotFormat.js';

const v1Snapshot = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 'v1',
  publicKey: { publicKey: 'abcd', addressHex: 'ff00', address: 'mn_addr_undeployed1...' },
  state: { availableUtxos: [], pendingUtxos: [] },
  protocolVersion: '0',
  networkId: 'undeployed',
  ...overrides,
});

describe('the unshielded snapshot format versions', () => {
  it('names v1 as what the V1 variant writes and v2 as the current version', () => {
    expect(V1_SNAPSHOT_FORMAT_VERSION).toBe('v1');
    expect(SNAPSHOT_FORMAT_VERSION).toBe('v2');
    expect(SNAPSHOT_FORMAT_VERSIONS).toEqual(['v1', 'v2']);
  });
});

describe('upgrading an unshielded snapshot from v1 to v2', () => {
  it('tags a bare-string verifying key as schnorr and stamps the new version', () => {
    expect(upgradeSnapshotV1ToV2(v1Snapshot())).toEqual(
      v1Snapshot({
        version: 'v2',
        publicKey: {
          publicKey: { tag: 'schnorr', value: 'abcd' },
          addressHex: 'ff00',
          address: 'mn_addr_undeployed1...',
        },
      }),
    );
  });

  it('treats a snapshot with no version as v1', () => {
    const { version: _version, ...unversioned } = v1Snapshot();

    expect(upgradeSnapshotV1ToV2(unversioned)).toMatchObject({
      version: 'v2',
      publicKey: { publicKey: { tag: 'schnorr', value: 'abcd' } },
    });
  });

  it('leaves a key that already carries its tag alone, so the pre-release tagged shape reads as v2', () => {
    const { version: _version, ...tagged } = v1Snapshot({
      publicKey: { publicKey: { tag: 'ecdsa', value: '02ab' }, addressHex: 'ff00', address: 'mn_addr_undeployed1...' },
    });

    expect(upgradeSnapshotV1ToV2(tagged)).toEqual({ ...tagged, version: 'v2' });
  });

  it('is idempotent: applying it twice is applying it once', () => {
    const once = upgradeSnapshotV1ToV2(v1Snapshot());

    expect(upgradeSnapshotV1ToV2(once)).toEqual(once);
  });

  it('preserves every other field, known or not, untouched', () => {
    const upgraded = upgradeSnapshotV1ToV2(v1Snapshot({ appliedId: '5', somethingNewer: { kept: true } })) as Record<
      string,
      unknown
    >;

    expect(upgraded['appliedId']).toBe('5');
    expect(upgraded['somethingNewer']).toEqual({ kept: true });
    expect(upgraded['state']).toEqual({ availableUtxos: [], pendingUtxos: [] });
  });

  it('does not overwrite a version it does not own', () => {
    // Filling in what is missing, never rewriting what is there: a `v3` payload is not this step's to touch, and the
    // schema after it is what refuses it.
    const newer = v1Snapshot({ version: 'v3' });

    expect(upgradeSnapshotV1ToV2(newer)).toEqual(newer);
  });

  it('hands anything that is not an object straight back for the schema to refuse', () => {
    expect(upgradeSnapshotV1ToV2('not a snapshot')).toBe('not a snapshot');
    expect(upgradeSnapshotV1ToV2(null)).toBeNull();
    expect(upgradeSnapshotV1ToV2([1, 2])).toEqual([1, 2]);
  });
});
