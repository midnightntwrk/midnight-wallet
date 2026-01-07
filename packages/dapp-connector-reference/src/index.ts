import type { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { Data } from 'effect';
import { SemVer } from 'semver';

export class InstallationError extends Data.TaggedError('InstallationError')<{
  message: string;
  cause: Error;
  uuid: string;
}> {}

export type ConnectorMetadata = Readonly<Omit<InitialAPI, 'connect'>>;
export const ConnectorMetadata = {
  currentApiVersion: new SemVer('4.0.0-beta.2'),
  empty: Object.freeze({
    name: '',
    icon: '',
    apiVersion: '',
    rdns: '',
  }) satisfies ConnectorMetadata,
  init: (metadata: Partial<ConnectorMetadata>): ConnectorMetadata =>
    Object.freeze(Object.assign({}, ConnectorMetadata.empty, metadata)),
  with:
    (overrides: Partial<ConnectorMetadata>) =>
    (metadata: ConnectorMetadata): ConnectorMetadata =>
      Object.freeze(Object.assign({}, metadata, overrides)),
};

type TargetObject<TKey extends string | symbol = 'midnight'> = { [K in TKey]?: Record<string, InitialAPI> };

export type InstallOptions<TKey extends string | symbol = 'midnight'> = {
  location?: TargetObject<TKey>;
  key?: TKey;
  uuid?: string;
};

export type InstalledConnector = Readonly<{
  connector: Connector;
  uuid: string;
}>;

export class Connector implements InitialAPI {
  private facade: WalletFacade;

  readonly rdns: string;
  readonly name: string;
  readonly icon: string;
  readonly apiVersion: string;

  constructor(metadata: ConnectorMetadata, facade: WalletFacade) {
    this.facade = facade;
    this.name = metadata.name;
    this.icon = metadata.icon;
    this.apiVersion = metadata.apiVersion;
    this.rdns = metadata.rdns;
  }

  async install<TKey extends string | symbol = 'midnight'>(
    options?: InstallOptions<TKey>,
  ): Promise<InstalledConnector> {
    return new Promise((resolve, reject) => {
      const targetObject: TargetObject<TKey> = options?.location ?? (globalThis as TargetObject<TKey>);
      const key: TKey = options?.key ?? ('midnight' as TKey);

      if (!Object.prototype.hasOwnProperty.call(targetObject, key)) {
        Object.defineProperty(targetObject, key, {
          value: Object.create(null),
          writable: false,
          enumerable: true,
          configurable: false,
        });
      }

      const hasIdInstalled = (uuid: string) => Object.prototype.hasOwnProperty.call(targetObject[key], uuid);

      const install = (uuid: string) => {
        Object.defineProperty(targetObject[key], uuid, {
          value: this.getInitialAPI(),
          writable: false,
          enumerable: true,
          configurable: false,
        });
        resolve({ connector: this, uuid });
      };

      const installUntilSuccess = () => {
        try {
          const uuid = crypto.randomUUID();
          install(uuid);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Error while installing connector, retrying...', error);
          return installUntilSuccess();
        }
      };

      if (options?.uuid !== undefined) {
        if (hasIdInstalled(options.uuid)) {
          reject(new InstallationError({ message: 'UUID already installed', cause: new Error(), uuid: options.uuid }));
        } else {
          return install(options.uuid);
        }
      } else {
        return installUntilSuccess();
      }
    });
  }

  getInitialAPI(): InitialAPI {
    return Object.freeze({
      name: this.name,
      icon: this.icon,
      apiVersion: this.apiVersion,
      rdns: this.rdns,
      connect: (networkId: string) => this.connect(networkId),
    });
  }

  connect(networkId: string): Promise<ConnectedAPI> {
    throw new Error('Not implemented');
  }
}
