import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as ProtocolVersion from '../ProtocolVersion.js';

describe('ProtocolVersion', () => {
  describe('is', () => {
    it('should return true for valid values', () => {
      expect(ProtocolVersion.is(100n)).toBeTruthy();
      expect(ProtocolVersion.is(ProtocolVersion.ProtocolVersion(100n))).toBeTruthy();
    });

    it('should return false for invalid values', () => {
      expect(ProtocolVersion.is('some-string')).toBeFalsy();
      expect(ProtocolVersion.is(100)).toBeFalsy();
      expect(ProtocolVersion.is(100.0)).toBeFalsy();
      expect(ProtocolVersion.is({ protocolVersion: 100n })).toBeFalsy();
    });
  });

  it.each([ProtocolVersion.MinSupportedVersion, ProtocolVersion.MaxSupportedVersion])(
    'should be encodable and decodable',
    (input) => {
      const encodedString = Schema.encodeSync(ProtocolVersion.ProtocolVersionSchema)(input);

      expect(encodedString).toBe(Number(input).toString());

      const protocolVersion = Schema.decodeSync(ProtocolVersion.ProtocolVersionSchema)(encodedString);

      expect(ProtocolVersion.is(protocolVersion)).toBeTruthy();
      expect(protocolVersion).toBe(input);
    },
  );
});
