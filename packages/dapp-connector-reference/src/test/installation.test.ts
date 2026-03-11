import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Connector, InstallationError } from '../index.js';
import * as fc from 'fast-check';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import { expectMatchObjectTyped, prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';
import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import type { ConnectorConfiguration } from '../types.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

const defaultConfig: ConnectorConfiguration = {
  networkId: 'testnet',
  indexerUri: 'http://localhost:8080',
  indexerWsUri: 'ws://localhost:8080',
  substrateNodeUri: 'ws://localhost:9944',
};

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
      prepareMockUnshieldedKeystore(),
      defaultConfig,
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
    const connector = new Connector(metadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig);

    expect(connector).toMatchObject(metadata);
  });

  it('should not install instance if just created', () => {
    const _connector = new Connector(
      randomValue(defaultConnectorMetadataArbitrary),
      prepareMockFacade(),
      prepareMockUnshieldedKeystore(),
      defaultConfig,
    );

    expect(globalThis.midnight).toBeUndefined();
  });

  describe('installing', () => {
    beforeEach(() => {
      globalThis.midnight = {};
    });

    it('should install instance on globalThis.midnight using a provided uuid', async () => {
      const uuid = crypto.randomUUID();
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig);
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
      const connector = new Connector(metadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig);

      await connector.install({ uuid });

      await expect(connector.install({ uuid })).rejects.toThrow(InstallationError);
    });

    it('should install instance on globalThis.midnight using a random uuid', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig);
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
      const connector = new Connector(metadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig);
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
      const connector = new Connector(metadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig);
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
      const connector = new Connector(metadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig);
      const installedConnector = await connector.install({ key });

      expect(globalThis).toHaveProperty([key, installedConnector.uuid]);
    });

    it('should install multiple connectors independently', async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(defaultConnectorMetadataArbitrary), async (connectorMetadatas) => {
          const target: { midnight?: Record<string, InitialAPI> } = {};
          const installedConnectors = await Promise.all(
            connectorMetadatas
              .map(
                (connectorMetadata) =>
                  new Connector(connectorMetadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig),
              )
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
      const connector = new Connector(metadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig);

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
      const connector = new Connector(metadata, prepareMockFacade(), prepareMockUnshieldedKeystore(), defaultConfig);

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
