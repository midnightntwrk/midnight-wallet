**[@midnight-ntwrk/dapp-connector-api v1.1.0](https://github.com/input-output-hk/midnight-wallet/typescript/dapp-connector-api)** • [Readme](../README.md) \| [API](../globals.md)

***

[@midnight-ntwrk/dapp-connector-api v1.1.0](../README.md) / ErrorCodes

# Variable: ErrorCodes

> **`const`** **ErrorCodes**: `Object`

The following error codes can be thrown by the dapp connector.

## Type declaration

### InternalError

> **`readonly`** **InternalError**: `"InternalError"` = `'InternalError'`

The dapp connector wasn't able to process the request

### InvalidRequest

> **`readonly`** **InvalidRequest**: `"InvalidRequest"` = `'InvalidRequest'`

Can be thrown in various circumstances, e.g. one being a malformed transaction

### Rejected

> **`readonly`** **Rejected**: `"Rejected"` = `'Rejected'`

The user rejected the request
