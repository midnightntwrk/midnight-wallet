import type { Configuration } from '@midnight-ntwrk/dapp-connector-api';

/**
 * Configuration required for the DApp Connector.
 * Contains network information and service URIs.
 */
export type ConnectorConfiguration = {
  /** The network ID this connector is configured for */
  networkId: string;
  /** HTTP URI for the indexer */
  indexerUri: string;
  /** WebSocket URI for the indexer */
  indexerWsUri: string;
  /** URI for the prover server (optional) */
  proverServerUri?: string | undefined;
  /** URI for the Substrate RPC node */
  substrateNodeUri: string;
};

/**
 * Convert internal connector configuration to the API Configuration type.
 * Returns a frozen object to ensure immutability.
 */
export const toAPIConfiguration = (config: ConnectorConfiguration): Configuration =>
  Object.freeze({
    networkId: config.networkId,
    indexerUri: config.indexerUri,
    indexerWsUri: config.indexerWsUri,
    proverServerUri: config.proverServerUri,
    substrateNodeUri: config.substrateNodeUri,
  });
