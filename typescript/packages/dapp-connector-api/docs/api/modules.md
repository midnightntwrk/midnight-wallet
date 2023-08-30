[DApp Connector API Reference - v2.9.2](README.md) / Exports

# DApp Connector API Reference - v2.9.2

## Table of contents

### Interfaces

- [APIError](interfaces/APIError.md)
- [DAppConnectorAPI](interfaces/DAppConnectorAPI.md)

### Type Aliases

- [DAppConnectorWalletAPI](modules.md#dappconnectorwalletapi)
- [ErrorCode](modules.md#errorcode)
- [WalletAPI](modules.md#walletapi)

### Variables

- [ErrorCodes](modules.md#errorcodes)

## Type Aliases

### DAppConnectorWalletAPI

Ƭ **DAppConnectorWalletAPI**: [`WalletAPI`](modules.md#walletapi) & `WalletState`

Shape of the Wallet API in the DApp Connector

#### Defined in

[api.ts:21](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/api.ts#L21)

___

### ErrorCode

Ƭ **ErrorCode**: typeof [`ErrorCodes`](modules.md#errorcodes)[keyof typeof [`ErrorCodes`](modules.md#errorcodes)]

ErrorCode type definition

#### Defined in

[errors.ts:16](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/errors.ts#L16)

___

### WalletAPI

Ƭ **WalletAPI**: `Pick`<`Wallet`, ``"submitTransaction"`` \| ``"balanceTransaction"`` \| ``"proveTransaction"``\>

The wallet functions that must be exposed

#### Defined in

[api.ts:16](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/api.ts#L16)

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

[errors.ts:4](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/errors.ts#L4)
