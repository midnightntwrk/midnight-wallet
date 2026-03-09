import { describe, expect, it } from 'vitest';
import { APIError, ErrorCodes } from '../errors.js';

describe('APIError', () => {
  describe('error structure', () => {
    it('should have correct type marker "DAppConnectorAPIError"', () => {
      const error = APIError.internalError('test reason');
      expect(error.type).toBe('DAppConnectorAPIError');
    });

    it('should be an instance of Error', () => {
      const error = APIError.internalError('test reason');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have a message property matching the reason', () => {
      const error = APIError.internalError('test reason');
      expect(error.message).toBe('test reason');
    });

    it('should have a name property set to DAppConnectorAPIError', () => {
      const error = APIError.internalError('test reason');
      expect(error.name).toBe('DAppConnectorAPIError');
    });

    it('should have a reason property', () => {
      const error = APIError.internalError('my specific reason');
      expect(error.reason).toBe('my specific reason');
    });

    it('should have a code property', () => {
      const error = APIError.internalError('test');
      expect(error.code).toBeDefined();
      expect(typeof error.code).toBe('string');
    });

    it('should be throwable like a regular Error', () => {
      const error = APIError.internalError('test');
      expect(() => {
        throw error;
      }).toThrow();
    });

    it('should be catchable like a regular Error', () => {
      try {
        throw APIError.internalError('test');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it('should have a stack trace', () => {
      const error = APIError.internalError('test');
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
    });
  });

  describe('internalError factory', () => {
    it('should create error with InternalError code', () => {
      const error = APIError.internalError('internal error occurred');
      expect(error.code).toBe(ErrorCodes.InternalError);
    });

    it('should set the reason correctly', () => {
      const error = APIError.internalError('internal error occurred');
      expect(error.reason).toBe('internal error occurred');
    });

    it('should set the type marker', () => {
      const error = APIError.internalError('test');
      expect(error.type).toBe('DAppConnectorAPIError');
    });

    it('should handle empty reason', () => {
      const error = APIError.internalError('');
      expect(error.reason).toBe('');
      expect(error.code).toBe(ErrorCodes.InternalError);
    });

    it('should handle long reason strings', () => {
      const longReason = 'a'.repeat(10000);
      const error = APIError.internalError(longReason);
      expect(error.reason).toBe(longReason);
    });

    it('should handle special characters in reason', () => {
      const specialReason = 'Error: "test" with <html> & symbols\n\ttab';
      const error = APIError.internalError(specialReason);
      expect(error.reason).toBe(specialReason);
    });
  });

  describe('rejected factory', () => {
    it('should create error with Rejected code', () => {
      const error = APIError.rejected('user rejected the request');
      expect(error.code).toBe(ErrorCodes.Rejected);
    });

    it('should set the reason correctly', () => {
      const error = APIError.rejected('user rejected the request');
      expect(error.reason).toBe('user rejected the request');
    });

    it('should set the type marker', () => {
      const error = APIError.rejected('test');
      expect(error.type).toBe('DAppConnectorAPIError');
    });
  });

  describe('invalidRequest factory', () => {
    it('should create error with InvalidRequest code', () => {
      const error = APIError.invalidRequest('malformed transaction');
      expect(error.code).toBe(ErrorCodes.InvalidRequest);
    });

    it('should set the reason correctly', () => {
      const error = APIError.invalidRequest('malformed transaction');
      expect(error.reason).toBe('malformed transaction');
    });

    it('should set the type marker', () => {
      const error = APIError.invalidRequest('test');
      expect(error.type).toBe('DAppConnectorAPIError');
    });
  });

  describe('permissionRejected factory', () => {
    it('should create error with PermissionRejected code', () => {
      const error = APIError.permissionRejected('permission denied');
      expect(error.code).toBe(ErrorCodes.PermissionRejected);
    });

    it('should set the reason correctly', () => {
      const error = APIError.permissionRejected('permission denied');
      expect(error.reason).toBe('permission denied');
    });

    it('should set the type marker', () => {
      const error = APIError.permissionRejected('test');
      expect(error.type).toBe('DAppConnectorAPIError');
    });
  });

  describe('disconnected factory', () => {
    it('should create error with Disconnected code', () => {
      const error = APIError.disconnected('connection lost');
      expect(error.code).toBe(ErrorCodes.Disconnected);
    });

    it('should set the reason correctly', () => {
      const error = APIError.disconnected('connection lost');
      expect(error.reason).toBe('connection lost');
    });

    it('should set the type marker', () => {
      const error = APIError.disconnected('test');
      expect(error.type).toBe('DAppConnectorAPIError');
    });
  });

  describe('ErrorCodes constants', () => {
    it('should have InternalError code', () => {
      expect(ErrorCodes.InternalError).toBe('InternalError');
    });

    it('should have Rejected code', () => {
      expect(ErrorCodes.Rejected).toBe('Rejected');
    });

    it('should have InvalidRequest code', () => {
      expect(ErrorCodes.InvalidRequest).toBe('InvalidRequest');
    });

    it('should have PermissionRejected code', () => {
      expect(ErrorCodes.PermissionRejected).toBe('PermissionRejected');
    });

    it('should have Disconnected code', () => {
      expect(ErrorCodes.Disconnected).toBe('Disconnected');
    });

    it('should have exactly 5 error codes', () => {
      expect(Object.keys(ErrorCodes)).toHaveLength(5);
    });

    it('should have all codes as strings', () => {
      for (const code of Object.values(ErrorCodes)) {
        expect(typeof code).toBe('string');
      }
    });
  });

  describe('isAPIError type guard', () => {
    it('should return true for errors created by internalError', () => {
      const error = APIError.internalError('test');
      expect(APIError.isAPIError(error)).toBe(true);
    });

    it('should return true for errors created by rejected', () => {
      const error = APIError.rejected('test');
      expect(APIError.isAPIError(error)).toBe(true);
    });

    it('should return true for errors created by invalidRequest', () => {
      const error = APIError.invalidRequest('test');
      expect(APIError.isAPIError(error)).toBe(true);
    });

    it('should return true for errors created by permissionRejected', () => {
      const error = APIError.permissionRejected('test');
      expect(APIError.isAPIError(error)).toBe(true);
    });

    it('should return true for errors created by disconnected', () => {
      const error = APIError.disconnected('test');
      expect(APIError.isAPIError(error)).toBe(true);
    });

    it('should return false for regular Error instances', () => {
      const error = new Error('regular error');
      expect(APIError.isAPIError(error)).toBe(false);
    });

    it('should return false for TypeError instances', () => {
      const error = new TypeError('type error');
      expect(APIError.isAPIError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(APIError.isAPIError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(APIError.isAPIError(undefined)).toBe(false);
    });

    it('should return false for strings', () => {
      expect(APIError.isAPIError('error string')).toBe(false);
    });

    it('should return false for numbers', () => {
      expect(APIError.isAPIError(42)).toBe(false);
    });

    it('should return false for objects with type property but not APIError', () => {
      const fakeError = { type: 'DAppConnectorAPIError', code: 'InternalError', reason: 'fake' };
      expect(APIError.isAPIError(fakeError)).toBe(false);
    });

    it('should return false for objects missing type property', () => {
      const incompleteError = { code: 'InternalError', reason: 'test' };
      expect(APIError.isAPIError(incompleteError)).toBe(false);
    });

    it('should return false for empty objects', () => {
      expect(APIError.isAPIError({})).toBe(false);
    });

    it('should return false for arrays', () => {
      expect(APIError.isAPIError(['error'])).toBe(false);
    });

    it('should return false for functions', () => {
      expect(APIError.isAPIError(() => {})).toBe(false);
    });
  });

  describe('error identity and distinctness', () => {
    it('should create distinct error instances for each call', () => {
      const error1 = APIError.internalError('test');
      const error2 = APIError.internalError('test');
      expect(error1).not.toBe(error2);
    });

    it('should allow errors with same reason but different codes', () => {
      const internal = APIError.internalError('same reason');
      const rejected = APIError.rejected('same reason');

      expect(internal.code).not.toBe(rejected.code);
      expect(internal.reason).toBe(rejected.reason);
    });
  });
});
