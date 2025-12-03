import { vi, beforeAll, afterAll, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

const mockCrypto = {
  getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
    if (array && ArrayBuffer.isView(array)) {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return array;
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue({ type: 'secret' }),
    deriveKey: vi.fn().mockResolvedValue({
      type: 'secret',
      algorithm: { name: 'AES-GCM', length: 256 },
      extractable: false,
      usages: ['encrypt', 'decrypt'],
    }),
    encrypt: vi.fn().mockImplementation(async (_algorithm, _key, data) => {
      return new Uint8Array(data.byteLength + 16).buffer;
    }),
    decrypt: vi.fn().mockImplementation(async (_algorithm, _key, data) => {
      const mockDecrypted = new TextEncoder().encode('decrypted-data');
      return mockDecrypted.buffer;
    }),
  },
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(7),
};

Object.defineProperty(globalThis, 'crypto', {
  value: mockCrypto,
  writable: true,
});

const mockIndexedDB = {
  open: vi.fn(),
  deleteDatabase: vi.fn(),
};

const mockIDBRequest = {
  result: null,
  error: null,
  onsuccess: null as ((ev: Event) => void) | null,
  onerror: null as ((ev: Event) => void) | null,
  onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
};

Object.defineProperty(globalThis, 'indexedDB', {
  value: mockIndexedDB,
  writable: true,
});

const mockChrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    id: 'test-extension-id',
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
  },
  windows: {
    create: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
};

Object.defineProperty(globalThis, 'chrome', {
  value: mockChrome,
  writable: true,
});

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterAll(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});
