[DApp Connector API Reference - v3.1.2](README.md) / Exports

# DApp Connector API Reference - v3.1.2

## Table of contents

### Classes

- [APIError](classes/APIError.md)

### Interfaces

- [DAppConnectorAPI](interfaces/DAppConnectorAPI.md)
- [DAppConnectorWalletState](interfaces/DAppConnectorWalletState.md)
- [ServiceUriConfig](interfaces/ServiceUriConfig.md)

### Type Aliases

- [DAppConnectorWalletAPI](modules.md#dappconnectorwalletapi)
- [ErrorCode](modules.md#errorcode)

### Variables

- [ErrorCodes](modules.md#errorcodes)

## Type Aliases

### DAppConnectorWalletAPI

Ƭ **DAppConnectorWalletAPI**: { `state`: () => `Promise`<[`DAppConnectorWalletState`](interfaces/DAppConnectorWalletState.md)\>  } & `Pick`<`Wallet`, ``"submitTransaction"`` \| ``"balanceTransaction"`` \| ``"proveTransaction"``\>

Shape of the Wallet API in the DApp Connector

#### Defined in

[api.ts:32](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/api.ts#L32)

___

### ErrorCode

Ƭ **ErrorCode**: typeof [`ErrorCodes`](modules.md#errorcodes)[keyof typeof [`ErrorCodes`](modules.md#errorcodes)]

ErrorCode type definition

#### Defined in

[errors.ts:16](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/errors.ts#L16)

## Variables

### ErrorCodes

• `Const` **ErrorCodes**: `Object`

The following error codes can be thrown by the dapp connector.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `InternalError` | ``"InternalError"`` | The dapp connector wasn't able to process the request |
| `InvalidRequest` | ``"InvalidRequest"`` | Can be thrown in various circumstances, e.g. one being a malformed transaction |
| `Rejected` | ``"Rejected"`` | The user rejected the request |

#### Defined in

[errors.ts:4](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/errors.ts#L4)
