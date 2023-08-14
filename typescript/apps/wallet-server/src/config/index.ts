import convict from 'convict';
import * as fs from 'node:fs';
import path from 'path';

export interface ServerConfig {
  host: string;
  port: number;
  nodeHost: string;
  nodePort: number;
  wallet: string | number;
  genesisFilePath: string;
  faucetUrl: string;
  confirmAll: boolean;
  cli: boolean;
}

const schema = {
  host: {
    doc: 'Host to expose the server on',
    default: '127.0.0.1',
    env: 'WALLET_HOST',
    arg: 'host',
  },
  port: {
    doc: 'Port, on which the server will be listening',
    default: 5206,
    format: 'port',
    env: 'WALLET_PORT',
    arg: 'port',
  },
  nodeHost: {
    doc: 'Host, where node is running',
    default: '127.0.0.1',
    env: 'NODE_HOST',
    arg: 'node-host',
  },
  nodePort: {
    doc: 'Port, where node is listening',
    default: 5205,
    format: 'port',
    env: 'NODE_PORT',
    arg: 'node-port',
  },
  wallet: {
    doc: 'Id of wallet to load',
    default: -1,
    format: (val: unknown) => {
      if (typeof val !== 'number' && typeof val !== 'string') {
        throw new Error('Expected wallet id to be a string or number');
      }
    },
    env: 'WALLET',
    arg: 'wallet',
  },
  cli: {
    doc: 'Whether to enable or disable Wallet CLI',
    default: false,
    env: 'cli',
    arg: 'cli',
  },
  confirmAll: {
    doc: 'Whether to confirm all requests (useful in modes, where stdin is not available)',
    default: false,
    env: 'CONFIRM_ALL',
    arg: 'confirm-all',
  },
  genesisFilePath: {
    doc: 'Path to genesis file',
    format: String,
    default: '',
    env: 'GENESIS_FILE_PATH',
    arg: 'genesis-file-path',
  },
  faucetUrl: {
    doc: 'URL, where faucet is located',
    format: String,
    default: 'http://127.0.0.1:5300',
    env: 'FAUCET_URL',
    arg: 'faucet-url',
  },
} as const;

const configSources = [
  { type: 'path', path: path.resolve(process.cwd(), 'config.json5') },
  { type: 'env', variableName: 'WALLET_CONFIG_FILE' },
] as const;

export const loadConfig = (): ServerConfig => {
  const initialConfig: convict.Config<ServerConfig> = convict<ServerConfig>(schema);

  console.log('Initializing configuration');
  const config = configSources
    .reduce((prev, source) => {
      switch (source.type) {
        case 'path':
          console.log(`Loading path ${source.path}`);
          if (fs.existsSync(source.path)) {
            return prev.loadFile(source.path);
          } else {
            return prev;
          }
        case 'env':
          console.log(`Loading file from ${source.variableName} environment variable`);
          // eslint-disable-next-line no-case-declarations
          const value = process.env[source.variableName];
          if (value !== undefined) {
            return prev.loadFile(value);
          } else {
            return prev;
          }
      }
    }, initialConfig)
    .validate();

  return {
    host: config.get('host'),
    port: config.get('port'),
    nodeHost: config.get('nodeHost'),
    nodePort: config.get('nodePort'),
    wallet: config.get('wallet'),
    genesisFilePath: config.get('genesisFilePath'),
    faucetUrl: config.get('faucetUrl'),
    confirmAll: config.get('confirmAll'),
    cli: config.get('cli'),
  };
};

export const configHelp = () => {
  const args = Object.entries(schema).map(
    ([key, value]) =>
      `--${value.arg.padEnd(22, ' ')}${value.doc}
      ${value.default != null ? `default:\t\t${value.default.toString()}` : 'required'}
      env variable:\t${value.env}
      json key:\t\t${key}\n`,
  );

  const sources = configSources.map((src) => {
    switch (src.type) {
      case 'env':
        return `- File path set by environment variable ${src.variableName}`;
      case 'path':
        return `- File ${src.path}`;
    }
  });

  return [...args, 'Additionally, configuration is loaded from:', ...sources].join('\n');
};
