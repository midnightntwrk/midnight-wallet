import { ProtocolVersion, VersionChangeType } from '@midnight-ntwrk/wallet-ts/abstractions';

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
