import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Connector, InstallationError } from '../index.js';
import * as fc from 'fast-check';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import { expectMatchObjectTyped } from './testUtils.js';
import { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { UnshieldedWallet, UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet, DustWalletState } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet, ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import * as rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Effect, Scope } from 'effect';
vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

function prepareRealFacade(): WalletFacade {
  throw new Error('Not implemented');
}

const runtimeScope: Scope.CloseableScope = await Scope.make().pipe(Effect.runPromise);

class MockShieldedWallet implements ShieldedWallet {
  // @ts-expect-error - runtime is not implemented
  runtime: ShieldedWallet['runtime'] = null;
  runtimeScope: Scope.CloseableScope = runtimeScope;
  rawState: rx.Subject<rx.ObservedValueOf<ShieldedWallet['rawState']>> = new rx.Subject();
  state: rx.Subject<ShieldedWalletState> = new rx.Subject();
  start = vi.fn();
  balanceTransaction = vi.fn();
  transferTransaction = vi.fn();
  initSwap = vi.fn();
  finalizeTransaction = vi.fn();
  submitTransaction = vi.fn();
  serializeState = vi.fn();
  waitForSyncedState = vi.fn();
  getAddress = vi.fn();
  stop = vi.fn();
}
class MockUnshieldedWallet implements UnshieldedWallet {
  // @ts-expect-error - runtime is not implemented
  runtime: UnshieldedWallet['runtime'] = null;
  runtimeScope = runtimeScope;
  rawState: rx.Subject<rx.ObservedValueOf<UnshieldedWallet['rawState']>> = new rx.Subject();
  state: rx.Subject<UnshieldedWalletState> = new rx.Subject();
  start = vi.fn();
  balanceTransaction = vi.fn();
  transferTransaction = vi.fn();
  initSwap = vi.fn();
  signTransaction = vi.fn();
  serializeState = vi.fn();
  waitForSyncedState = vi.fn();
  getAddress = vi.fn();
  stop = vi.fn();
}
class MockDustWallet implements DustWallet {
  // @ts-expect-error - runtime is not implemented
  runtime: DustWallet['runtime'] = null;
  runtimeScope = runtimeScope;
  rawState: rx.Subject<rx.ObservedValueOf<DustWallet['rawState']>> = new rx.Subject();
  state: rx.Subject<DustWalletState> = new rx.Subject();
  start = vi.fn();
  createDustGenerationTransaction = vi.fn();
  addDustGenerationSignature = vi.fn();
  calculateFee = vi.fn();
  addFeePayment = vi.fn();
  finalizeTransaction = vi.fn();
  submitTransaction = vi.fn();
  serializeState = vi.fn();
  waitForSyncedState = vi.fn();
  getAddress = vi.fn();
  stop = vi.fn();
}
class MockWalletFacade extends WalletFacade {
  shielded: MockShieldedWallet;
  unshielded: MockUnshieldedWallet;
  dust: MockDustWallet;
  constructor() {
    const shielded = new MockShieldedWallet();
    const unshielded = new MockUnshieldedWallet();
    const dust = new MockDustWallet();
    super(shielded, unshielded, dust);
    this.shielded = shielded;
    this.unshielded = unshielded;
    this.dust = dust;
  }
}

function prepareMockFacade(): WalletFacade {
  return new MockWalletFacade();
}

describe('DappConnectorReference', () => {
  it('should create a connector instance with provided values', () => {
    const connector = new Connector(
      {
        name: 'test',
        icon: 'https://example.com/icon.png',
        apiVersion: '1.0.0',
        rdns: 'com.example.wallet',
      },
      prepareMockFacade(),
    );

    expectMatchObjectTyped(connector, {
      name: 'test',
      icon: 'https://example.com/icon.png',
      apiVersion: '1.0.0',
      rdns: 'com.example.wallet',
    });
  });

  it('should create a connector instance with random values', () => {
    const metadata = randomValue(defaultConnectorMetadataArbitrary);
    const connector = new Connector(metadata, prepareMockFacade());

    expect(connector).toMatchObject(metadata);
  });

  it('should not install instance if just created', () => {
    const connector = new Connector(randomValue(defaultConnectorMetadataArbitrary), prepareMockFacade());

    expect(globalThis.midnight).toBeUndefined();
  });

  describe('installing', () => {
    beforeEach(() => {
      globalThis.midnight = {};
    });

    it('should install instance on globalThis.midnight using a provided uuid', async () => {
      const uuid = crypto.randomUUID();
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade());
      const installedConnector = await connector.install({ uuid });

      expectMatchObjectTyped(globalThis.midnight![uuid], {
        name: installedConnector.connector.name,
        icon: installedConnector.connector.icon,
        apiVersion: installedConnector.connector.apiVersion,
        rdns: installedConnector.connector.rdns,
      });
      expect(Object.isFrozen(globalThis.midnight![uuid])).toBe(true);
    });

    it('should fail to install instance on globalThis.midnight using a provided uuid if it already exists', async () => {
      const uuid = crypto.randomUUID();
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade());

      await connector.install({ uuid });

      await expect(connector.install({ uuid })).rejects.toThrow(InstallationError);
    });

    it('should install instance on globalThis.midnight using a random uuid', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade());
      const installedConnector = await connector.install();

      expectMatchObjectTyped(globalThis.midnight![installedConnector.uuid], {
        name: installedConnector.connector.name,
        icon: installedConnector.connector.icon,
        apiVersion: installedConnector.connector.apiVersion,
        rdns: installedConnector.connector.rdns,
      });
    });

    it('should install instance under specified object using a random uuid', async () => {
      const target: { midnight?: Record<string, InitialAPI> } = {};
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade());
      const installedConnector = await connector.install({ location: target });

      expectMatchObjectTyped(target.midnight![installedConnector.uuid], {
        name: connector.name,
        icon: connector.icon,
        apiVersion: connector.apiVersion,
        rdns: connector.rdns,
      });
    });

    it('should install instance under specified object with a specified key, using a random uuid', async () => {
      const target: { test?: Record<string, InitialAPI> } = {};
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade());
      const installedConnector = await connector.install({ location: target, key: 'test' });

      expectMatchObjectTyped(target.test![installedConnector.uuid], {
        name: connector.name,
        icon: connector.icon,
        apiVersion: connector.apiVersion,
        rdns: connector.rdns,
      });
    });

    it('should install instance under window with a specified key, using a random uuid', async () => {
      const key = crypto.randomUUID();
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade());
      const installedConnector = await connector.install({ key });

      expect(globalThis).toHaveProperty([key, installedConnector.uuid]);
    });

    it('should install multiple connectors independently', async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(defaultConnectorMetadataArbitrary), async (connectorMetadatas) => {
          const target: { midnight?: Record<string, InitialAPI> } = {};
          const installedConnectors = await Promise.all(
            connectorMetadatas
              .map((connectorMetadata) => new Connector(connectorMetadata, prepareMockFacade()))
              .map((connector) => connector.install({ location: target })),
          );

          for (const installedConnector of installedConnectors) {
            expect(target.midnight).toHaveProperty(installedConnector.uuid);
            expectMatchObjectTyped(target.midnight![installedConnector.uuid], {
              name: installedConnector.connector.name,
              icon: installedConnector.connector.icon,
              apiVersion: installedConnector.connector.apiVersion,
              rdns: installedConnector.connector.rdns,
            });
          }
        }),
      );
    });

    it('should init the key in a safe way', async () => {
      const target: { test?: Record<string, InitialAPI> } = {};
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade());

      await connector.install({ location: target, key: 'test' });
      const propertyDescriptor = Object.getOwnPropertyDescriptor(target, 'test');

      expectMatchObjectTyped(propertyDescriptor, {
        writable: false,
        enumerable: true,
        configurable: false,
      });
    });

    it('should install connector in a safe way', async () => {
      const target: { midnight?: Record<string, InitialAPI> } = {};
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade());

      const installedConnector = await connector.install({ location: target });
      const propertyDescriptor = Object.getOwnPropertyDescriptor(target.midnight, installedConnector.uuid);

      expectMatchObjectTyped(propertyDescriptor, {
        writable: false,
        enumerable: true,
        configurable: false,
      });
      expect(Object.isFrozen(propertyDescriptor!.value)).toBe(true);
    });
  });
});
