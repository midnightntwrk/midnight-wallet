import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatAmount,
  parseAmount,
  formatAmountWithSymbol,
  truncateAddress,
  formatDate,
  formatRelativeTime,
  isValidMidnightAddress,
} from './format';

describe('format utilities', () => {
  describe('formatAmount', () => {
    it('formats whole numbers correctly', () => {
      expect(formatAmount(BigInt('100000000'))).toBe('1');
      expect(formatAmount(BigInt('1000000000'))).toBe('10');
      expect(formatAmount(BigInt('0'))).toBe('0');
    });

    it('formats decimal amounts correctly', () => {
      expect(formatAmount(BigInt('150000000'))).toBe('1.5');
      expect(formatAmount(BigInt('123456789'))).toBe('1.23456789');
      expect(formatAmount(BigInt('100000001'))).toBe('1.00000001');
    });

    it('trims trailing zeros from decimals', () => {
      expect(formatAmount(BigInt('150000000'))).toBe('1.5');
      expect(formatAmount(BigInt('120000000'))).toBe('1.2');
      expect(formatAmount(BigInt('100000000'))).toBe('1');
    });

    it('handles string input', () => {
      expect(formatAmount('100000000')).toBe('1');
      expect(formatAmount('50000000')).toBe('0.5');
    });

    it('handles custom decimal places', () => {
      expect(formatAmount(BigInt('1000'), 3)).toBe('1');
      expect(formatAmount(BigInt('1500'), 3)).toBe('1.5');
    });

    it('handles very small amounts', () => {
      expect(formatAmount(BigInt('1'))).toBe('0.00000001');
      expect(formatAmount(BigInt('10'))).toBe('0.0000001');
    });

    it('handles very large amounts', () => {
      expect(formatAmount(BigInt('999999999900000000'))).toBe('9999999999');
      expect(formatAmount(BigInt('100000000000000000'))).toBe('1000000000');
    });
  });

  describe('parseAmount', () => {
    it('parses whole numbers correctly', () => {
      expect(parseAmount('1')).toBe(BigInt('100000000'));
      expect(parseAmount('10')).toBe(BigInt('1000000000'));
      expect(parseAmount('0')).toBe(BigInt('0'));
    });

    it('parses decimal amounts correctly', () => {
      expect(parseAmount('1.5')).toBe(BigInt('150000000'));
      expect(parseAmount('1.23456789')).toBe(BigInt('123456789'));
      expect(parseAmount('0.5')).toBe(BigInt('50000000'));
    });

    it('handles empty or invalid input', () => {
      expect(parseAmount('')).toBe(BigInt('0'));
      expect(parseAmount('.')).toBe(BigInt('0'));
    });

    it('sanitizes non-numeric characters', () => {
      expect(parseAmount('1.5abc')).toBe(BigInt('150000000'));
      expect(parseAmount('$100')).toBe(BigInt('10000000000'));
    });

    it('truncates excess decimal places', () => {
      expect(parseAmount('1.123456789999')).toBe(BigInt('112345678'));
    });

    it('throws error for amounts too large', () => {
      expect(() => parseAmount('999999999999999999999')).toThrow('Amount too large');
    });

    it('throws error for amounts exceeding max safe value', () => {
      expect(() => parseAmount('100000000000000')).toThrow('Amount exceeds maximum allowed value');
    });

    it('handles custom decimal places', () => {
      expect(parseAmount('1.5', 3)).toBe(BigInt('1500'));
      expect(parseAmount('10', 2)).toBe(BigInt('1000'));
    });
  });

  describe('formatAmountWithSymbol', () => {
    it('appends default symbol', () => {
      expect(formatAmountWithSymbol(BigInt('100000000'))).toBe('1 tDUST');
    });

    it('appends custom symbol', () => {
      expect(formatAmountWithSymbol(BigInt('100000000'), 'DUST')).toBe('1 DUST');
      expect(formatAmountWithSymbol(BigInt('150000000'), 'MID')).toBe('1.5 MID');
    });
  });

  describe('truncateAddress', () => {
    it('truncates long addresses', () => {
      const address = 'mn_dust_1234567890abcdefghijklmnopqrstuvwxyz';
      const truncated = truncateAddress(address);
      expect(truncated).toBe('mn_dust_12...uvwxyz');
    });

    it('returns short addresses unchanged', () => {
      const shortAddress = 'mn_dust_abc';
      expect(truncateAddress(shortAddress)).toBe(shortAddress);
    });

    it('uses custom start and end characters', () => {
      const address = 'mn_dust_1234567890abcdefghijklmnopqrstuvwxyz';
      expect(truncateAddress(address, 5, 5)).toBe('mn_du...vwxyz');
      expect(truncateAddress(address, 15, 10)).toBe('mn_dust_1234567...qrstuvwxyz');
    });

    it('handles edge cases', () => {
      expect(truncateAddress('')).toBe('');
      expect(truncateAddress('abc')).toBe('abc');
    });
  });

  describe('formatDate', () => {
    it('formats timestamp to readable date', () => {
      const timestamp = new Date('2024-01-15T14:30:00').getTime();
      const formatted = formatDate(timestamp);
      expect(formatted).toContain('Jan');
      expect(formatted).toContain('15');
      expect(formatted).toContain('2024');
    });

    it('includes time component', () => {
      const timestamp = new Date('2024-06-20T09:45:00').getTime();
      const formatted = formatDate(timestamp);
      expect(formatted).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "Just now" for recent timestamps', () => {
      const now = Date.now();
      expect(formatRelativeTime(now)).toBe('Just now');
      expect(formatRelativeTime(now - 30000)).toBe('Just now');
    });

    it('returns minutes ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 60000)).toBe('1 minute ago');
      expect(formatRelativeTime(now - 120000)).toBe('2 minutes ago');
      expect(formatRelativeTime(now - 3540000)).toBe('59 minutes ago');
    });

    it('returns hours ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 3600000)).toBe('1 hour ago');
      expect(formatRelativeTime(now - 7200000)).toBe('2 hours ago');
      expect(formatRelativeTime(now - 82800000)).toBe('23 hours ago');
    });

    it('returns days ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 86400000)).toBe('1 day ago');
      expect(formatRelativeTime(now - 172800000)).toBe('2 days ago');
      expect(formatRelativeTime(now - 604800000)).toBe('7 days ago');
    });
  });

  describe('isValidMidnightAddress', () => {
    it('returns true for valid addresses', () => {
      const validAddress = 'mn_dust_' + 'a'.repeat(50);
      expect(isValidMidnightAddress(validAddress)).toBe(true);
    });

    it('returns false for addresses without correct prefix', () => {
      expect(isValidMidnightAddress('invalid_' + 'a'.repeat(50))).toBe(false);
      expect(isValidMidnightAddress('mn_test_' + 'a'.repeat(50))).toBe(false);
    });

    it('returns false for addresses too short', () => {
      expect(isValidMidnightAddress('mn_dust_abc')).toBe(false);
      expect(isValidMidnightAddress('mn_dust_' + 'a'.repeat(20))).toBe(false);
    });

    it('returns false for addresses too long', () => {
      expect(isValidMidnightAddress('mn_dust_' + 'a'.repeat(200))).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidMidnightAddress('')).toBe(false);
    });
  });

  describe('roundtrip conversions', () => {
    it('parseAmount and formatAmount are inverse operations', () => {
      const amounts = ['1', '0.5', '123.456', '0.00000001', '9999999'];
      for (const amount of amounts) {
        const parsed = parseAmount(amount);
        const formatted = formatAmount(parsed);
        expect(parseFloat(formatted)).toBeCloseTo(parseFloat(amount));
      }
    });
  });
});
