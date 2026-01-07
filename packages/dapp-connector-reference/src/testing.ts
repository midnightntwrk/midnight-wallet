import * as fc from 'fast-check';
import { ConnectorMetadata } from './index.js';
import { SemVer } from 'semver';
import { pipe } from 'effect';

export const randomValue = <T>(arbitrary: fc.Arbitrary<T>): T => {
  return fc.sample(arbitrary, 1).at(0)!;
};

const nameArbitrary = fc.oneof(fc.string(), fc.lorem({ maxCount: 10 }));
const iconArbitrary = fc.oneof(
  fc.constant(''),
  fc.string(),
  fc.webUrl({
    validSchemes: ['http', 'https'],
    withFragments: true,
    withQueryParameters: true,
  }),
  fc
    .record({
      data: fc.uint8Array().map((data) => Buffer.from(data).toString('base64')),
      mimeType: fc.constantFrom('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'),
    })
    .map(({ data, mimeType }) => `data:${mimeType};base64,${data}`),
);
const rdnsArbitrary = fc.oneof(
  fc.string(),
  fc.lorem({ maxCount: 10 }).map((words) =>
    words
      .split(' ')
      .map((word) => word.toLowerCase())
      .join('.'),
  ),
  fc.domain().map((domain) => domain.split('.').toReversed().join('.')),
);

const repeat =
  <T>(n: number, cb: (acc: T, n: number) => T) =>
  (initial: T): T => {
    let acc = initial;
    for (let i = 0; i < n; i++) {
      acc = cb(acc, i);
    }
    return acc;
  };

const compatibleVersionArbitrary = fc
  .record({
    minorIncrements: fc.nat({ max: 100 }),
    patchIncrements: fc.nat({ max: 100 }),
  })
  .map(({ minorIncrements, patchIncrements }) => {
    const currentVersion = ConnectorMetadata.currentApiVersion;
    return pipe(
      currentVersion,
      repeat(minorIncrements, (ver) => ver.inc('minor')),
      repeat(patchIncrements, (ver) => ver.inc('patch')),
    );
  });

const anyVersionArbitrary = fc
  .record({
    major: fc.nat(),
    minor: fc.nat(),
    patch: fc.nat(),
    prerelease: fc.option(
      fc.record({
        type: fc.constantFrom('beta', 'alpha', 'rc'),
        version: fc.nat(),
      }),
    ),
  })
  .map(({ major, minor, patch, prerelease }) => {
    const prereleaseSuffix = prerelease ? `-${prerelease.type}.${prerelease.version}` : '';
    return new SemVer(`${major}.${minor}.${patch}${prereleaseSuffix}`);
  });

export const defaultConnectorMetadataArbitrary = fc.record({
  name: nameArbitrary,
  icon: iconArbitrary,
  apiVersion: compatibleVersionArbitrary.map((ver: SemVer): string => ver.format()),
  rdns: rdnsArbitrary,
});

export const anyConnectorMetadataArbitrary = fc.record({
  name: nameArbitrary,
  icon: iconArbitrary,
  apiVersion: fc.oneof(compatibleVersionArbitrary, anyVersionArbitrary).map((ver: SemVer): string => ver.format()),
  rdns: rdnsArbitrary,
});
